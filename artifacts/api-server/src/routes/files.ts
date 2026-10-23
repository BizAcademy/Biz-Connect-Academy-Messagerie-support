import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PrivateFile, Admin, Conversation } from "@workspace/db";
import { UpdateProfileBody, UpdateProfileResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { authorizeConversation } from "../services/conversations";
import { storePrivate, readPrivate, removePrivate, probeAudio } from "../services/storage";
import { publicAccount, accountModel } from "../services/accounts";
import { notifyConversation } from "../services/realtime";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 3 } });
const limitUploads = rateLimit({ windowMs: 60000, limit: 15, message: { error: "Trop de fichiers. Veuillez patienter." } });
const fields = z.object({ purpose: z.enum(["image", "voice", "avatar"]), conversationId: z.string().uuid().optional() });
router.post("/files", requireAuth, limitUploads, upload.single("file"), async (req, res) => {
  const parsed = fields.safeParse(req.body);
  if (!parsed.success || !req.file) { res.status(400).json({ error: "Fichier ou destination invalide." }); return; }
  const { purpose, conversationId } = parsed.data;
  if (purpose !== "avatar" && (!conversationId || !await authorizeConversation(conversationId, req.identity!))) {
    res.status(404).json({ error: "Conversation introuvable." }); return;
  }
  let bytes = req.file.buffer, duration: number | null = null, mime = "";
  const detected = await fileTypeFromBuffer(bytes);
  if (purpose === "voice") {
    if (!detected || !["audio/ogg", "video/ogg", "audio/webm", "video/webm", "audio/wav", "audio/mpeg", "audio/mp4", "video/mp4"].includes(detected.mime)) {
      res.status(415).json({ error: "Format vocal non autorisé." }); return;
    }
    try { duration = await probeAudio(bytes); }
    catch { res.status(400).json({ error: "Impossible de vérifier la durée du vocal. Vérifiez le fichier et la disponibilité de FFprobe sur le serveur." }); return; }
    if (duration > 300.5) { res.status(400).json({ error: "Un vocal ne peut pas dépasser 5 minutes." }); return; }
    mime = detected.mime === "video/webm" ? "audio/webm" : detected.mime === "video/mp4" ? "audio/mp4" : detected.mime;
  } else {
    if (bytes.length > 5 * 1024 * 1024) { res.status(413).json({ error: "Les images sont limitées à 5 Mo." }); return; }
    if (!detected || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(detected.mime)) {
      res.status(415).json({ error: "Utilisez une image JPEG, PNG, WebP ou GIF." }); return;
    }
    try {
      // Re-encoding strips metadata and active/polyglot payloads.
      let pipeline = sharp(bytes, { limitInputPixels: 30_000_000 }).rotate();
      pipeline = purpose === "avatar" ? pipeline.resize(512, 512, { fit: "cover" })
        : pipeline.resize(2048, 2048, { fit: "inside", withoutEnlargement: true });
      bytes = await pipeline.webp({ quality: 85 }).toBuffer(); mime = "image/webp";
    } catch { res.status(400).json({ error: "Image invalide ou trop grande." }); return; }
  }
  const storedPath = await storePrivate(bytes);
  try {
    const id = randomUUID();
    await PrivateFile.create({ id, ownerId: req.identity!.id, conversationId: purpose === "avatar" ? null : conversationId,
      purpose, path: storedPath, mime, size: bytes.length, duration });
    res.status(201).json({ id, url: `/api/files/${id}`, mime, size: bytes.length });
  } catch (err) { await removePrivate(storedPath); throw err; }
});
router.get("/files/:id", requireAuth, async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(404).json({ error: "Fichier introuvable." }); return; }
  const file = await PrivateFile.findByPk(id.data);
  if (!file) { res.status(404).json({ error: "Fichier introuvable." }); return; }
  const f = file.get(), identity = req.identity!;
  let allowed = f.ownerId === identity.id || identity.role === "admin";
  if (!allowed && f.conversationId) allowed = !!await authorizeConversation(f.conversationId, identity);
  if (!allowed && f.purpose === "avatar") allowed = !!await Admin.findOne({ where: { avatarFileId: f.id } });
  if (!allowed) { res.status(404).json({ error: "Fichier introuvable." }); return; }
  const bytes = await readPrivate(f.path);
  res.set({ "Content-Type": f.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
  const extension = f.mime.split("/")[1].replace(/[^a-z0-9]/g, "");
  res.set("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="biz-connect-${f.id}.${extension}"`);
  const range = req.get("range");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) { res.status(416).set("Content-Range", `bytes */${bytes.length}`).end(); return; }
    const start = Number(match[1]), end = match[2] ? Number(match[2]) : bytes.length - 1;
    if (start > end || end >= bytes.length) { res.status(416).set("Content-Range", `bytes */${bytes.length}`).end(); return; }
    res.status(206).set("Content-Range", `bytes ${start}-${end}/${bytes.length}`).set("Content-Length", String(end - start + 1)).send(bytes.subarray(start, end + 1)); return;
  }
  res.set("Content-Length", String(bytes.length)).send(bytes);
});
router.patch("/profile", requireAuth, async (req, res) => {
  const parsed = UpdateProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Photo invalide." }); return; }
  const file = await PrivateFile.findOne({ where: { id: parsed.data.avatarFileId, ownerId: req.identity!.id, purpose: "avatar" } });
  if (!file) { res.status(404).json({ error: "Photo introuvable." }); return; }
  await accountModel(req.identity!.role).update({ avatarFileId: file.get("id") }, { where: { id: req.identity!.id } });
  const affected = await Conversation.findAll({
    ...(req.identity!.role === "member" ? { where: { userId: req.identity!.id } } : {}),
    attributes: ["id", "userId"],
  });
  for (const c of affected) notifyConversation(c.get("id") as string, c.get("userId") as string);
  res.json(UpdateProfileResponse.parse(await publicAccount(req.identity!)));
});
export default router;
