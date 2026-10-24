import type { RequestHandler } from "express";

// Multer uses memory storage. Never allow 100 x 12 MB buffers + image decoders
// to accumulate together on a small Plesk process.
let active = 0;
const waiting: Array<() => void> = [];
export const uploadCapacity: RequestHandler = (req, res, next) => {
  let started = false, ended = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const start = () => {
    if (ended) { release(); return; }
    started = true; clearTimeout(timeout); next();
  };
  const release = () => {
    const queued = waiting.shift();
    if (queued) queued(); else active--;
  };
  const finish = () => {
    if (ended) return;
    ended = true; clearTimeout(timeout);
    if (started) release();
    else { const i = waiting.indexOf(start); if (i >= 0) waiting.splice(i, 1); }
  };
  res.once("finish", finish); res.once("close", finish);
  if (active < 4) { active++; start(); return; }
  if (waiting.length >= 128) {
    res.set("Retry-After", "3").status(503).json({ error: "Beaucoup de médias sont en cours d’envoi. Réessayez dans quelques secondes." }); return;
  }
  waiting.push(start);
  timeout = setTimeout(() => {
    if (!started && !ended) res.set("Retry-After", "3").status(503).json({ error: "Le serveur traite les médias précédents. Votre média est conservé, réessayez." });
  }, 60000);
};
