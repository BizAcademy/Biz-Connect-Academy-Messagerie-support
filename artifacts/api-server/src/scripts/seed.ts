import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { User, Admin, Conversation, MessageRecord, sequelize } from "@workspace/db";
import { logger } from "../lib/logger";

// Explicitly invoked, idempotent seed. Never runs at server startup.
async function seed() {
  const demo = process.argv.includes("--demo");
  if (demo && process.env.NODE_ENV === "production") throw new Error("Demo seed is forbidden in production");
  if (!demo) {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    if (!username || !password || password.length < 14) throw new Error("Set ADMIN_USERNAME and ADMIN_PASSWORD (14+ characters) before seeding.");
    await Admin.findOrCreate({ where: { username }, defaults: {
      id: randomUUID(), username, credentialHash: await bcrypt.hash(password, 12), phone: "", isDemo: false,
    } });
    logger.info("Admin seed complete");
    return;
  }
  const [admin] = await Admin.findOrCreate({ where: { username: "Équipe Biz Connect" }, defaults: {
    id: randomUUID(), username: "Équipe Biz Connect", credentialHash: await bcrypt.hash(randomBytes(32).toString("hex"), 12),
    phone: "", isDemo: true, createdAt: new Date(Date.now() - 86400000),
  } });
  const fixtures = [
    { username: "Amina Diallo", phone: "+237 600 000 101", favorite: true, messages: [
      ["member", "Bonjour ! Je viens de rejoindre l'académie et j'aimerais savoir comment accéder à ma formation."],
      ["admin", "Bonjour Amina, bienvenue chez Biz Connect Academy ! Nous sommes ravis de vous accompagner."],
      ["admin", "Vous retrouverez toutes vos formations dans votre espace membre, rubrique « Mes formations ». Avez-vous pu vous connecter ?"],
      ["member", "Oui, merci beaucoup ! J'ai bien accès à mon espace."],
      ["member", "Est-ce que les sessions en direct sont aussi disponibles en replay ?"],
    ] },
    { username: "Kevin Mbarga", phone: "+237 600 000 102", favorite: false, messages: [
      ["member", "Bonjour l'équipe, où puis-je retrouver mon certificat de formation ?"],
      ["admin", "Bonjour Kevin ! Votre certificat se trouve dans votre espace membre, après validation du dernier module."],
      ["member", "Parfait, je viens de le télécharger. Merci pour votre aide !"],
    ] },
    { username: "Fatou Ndiaye", phone: "+237 600 000 103", favorite: true, messages: [
      ["member", "Bonjour, j'aimerais en savoir plus sur le programme de mentorat."],
      ["admin", "Bonjour Fatou ! Le mentorat vous permet de bénéficier d'un accompagnement personnalisé. Quel est votre objectif ?"],
      ["member", "Je souhaite développer mon activité en ligne. Quels sont les prochains créneaux ?"],
    ] },
  ];
  for (const [i, fixture] of fixtures.entries()) {
    const [user] = await User.findOrCreate({ where: { username: fixture.username }, defaults: {
      id: randomUUID(), username: fixture.username, phone: fixture.phone,
      credentialHash: await bcrypt.hash(randomBytes(24).toString("hex"), 12), isDemo: true,
      createdAt: new Date(Date.now() - 3600000 * (4 - i)),
    } });
    const [conversation, created] = await Conversation.findOrCreate({ where: { userId: user.get("id") }, defaults: {
      id: randomUUID(), userId: user.get("id"), favorite: fixture.favorite,
      lastMessageAt: new Date(Date.now() - i * 420000),
    } });
    if (created) await MessageRecord.bulkCreate(fixture.messages.map(([role, content], j) => ({
      id: randomUUID(), conversationId: conversation.get("id"), senderId: role === "admin" ? admin.get("id") : user.get("id"),
      senderRole: role, type: "text", content,
      isRead: j < fixture.messages.length - 1, status: j < fixture.messages.length - 1 ? "read" : "sent",
      createdAt: new Date(Date.now() - i * 420000 - (fixture.messages.length - j - 1) * 120000),
    })));
  }
  logger.info("Development demo accounts seeded (no known credential passwords)");
}
seed().then(() => sequelize.close()).catch((err) => { logger.error({ err }, "Seed failed"); process.exitCode = 1; });
