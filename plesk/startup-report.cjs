"use strict";
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(__dirname, ".startup-status.json");
function safeError(error) {
  const code = /^[A-Z0-9_]{1,60}$/.test(error?.code || "") ? error.code : "BCA_STARTUP_ERROR";
  // Only our own diagnostics can be returned verbatim. Never record the raw
  // exception, stack, connection string, environment values or database error.
  if (/^BCA_[A-Z_]+$/.test(error?.code || "") && error?.message?.length < 600) return { code, message: error.message };
  const missing = /Cannot find (?:package|module) ['"]([^'"]+)/i.exec(String(error?.message || ""))?.[1];
  return {
    code,
    message: missing && /^[@a-zA-Z0-9][@a-zA-Z0-9/._-]{0,120}$/.test(missing)
      ? `Module manquant : ${missing}` : `Échec du serveur (${code}).`,
  };
}
function write(stage, error) {
  if (process.env.BCA_DIAGNOSTIC === "1") return;
  const report = { at: new Date().toISOString(), stage, node: process.version,
    passenger: Boolean(global.PhusionPassenger), error: error ? safeError(error) : null };
  try { fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); }
  catch { /* A read-only app root must not prevent startup. */ }
}
function read() {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
module.exports = { write, read, safeError };
