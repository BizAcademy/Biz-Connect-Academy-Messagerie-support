import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function testInit(initializeDatabase) {
  const sql = await readFile(path.join(root, "lib/db/mysql/initial.sql"), "utf8");
  const expected = ["users", "admins", "presence", "sessions", "conversations", "files", "messages", "push_subscriptions"];
  function fake(initial = [], options = {}) {
    const state = { tables: [...initial], writes: [], released: false };
    state.query = async ({ sql }) => {
      if (/^SELECT GET_LOCK/.test(sql)) return [[{ acquired: options.locked ? 0 : 1 }]];
      if (/^SELECT RELEASE_LOCK/.test(sql)) { state.released = true; return [[{}]]; }
      if (sql.includes("information_schema.TABLES")) return [state.tables.map((name) => ({ name }))];
      state.writes.push(sql);
      const name = /^CREATE TABLE ([a-z_]+)/i.exec(sql)?.[1];
      if (name) {
        if (name === options.failAt) throw Object.assign(new Error("private-credential-never-print"), { code: "ER_TABLEACCESS_DENIED_ERROR" });
        state.tables.push(name);
      }
      return [[]];
    };
    return state;
  }
  const empty = fake();
  assert.equal(await initializeDatabase(empty, sql), "created");
  assert.deepEqual(empty.tables, expected);
  assert.equal(empty.writes.filter((s) => /^CREATE TABLE /i.test(s)).length, 8);
  assert(empty.released);
  const already = fake(expected);
  assert.equal(await initializeDatabase(already, sql), "already-present");
  assert.equal(already.writes.length, 0);
  assert(already.released);
  for (const tables of [["users"], ["unrelated_table"]]) {
    const existing = fake(tables);
    await assert.rejects(initializeDatabase(existing, sql), { code: "BCA_SCHEMA_NOT_EMPTY" });
    assert.equal(existing.writes.length, 0);
    assert.deepEqual(existing.tables, tables);
    assert(existing.released);
  }
  const locked = fake([], { locked: true });
  await assert.rejects(initializeDatabase(locked, sql), { code: "BCA_SCHEMA_BUSY" });
  assert.equal(locked.writes.length, 0);
  const invalid = fake();
  await assert.rejects(initializeDatabase(invalid, sql + "\nDROP TABLE users;"), { code: "BCA_SCHEMA_SCRIPT" });
  assert.equal(invalid.writes.length, 0);
  const partial = fake([], { failAt: "conversations" });
  await assert.rejects(initializeDatabase(partial, sql), (error) =>
    error.code === "BCA_SCHEMA_INIT_FAILED" && !error.message.includes("private-credential-never-print"));
  assert.deepEqual(partial.tables, expected.slice(0, 4));
  assert(partial.released);
  const previousWrites = partial.writes.length;
  await assert.rejects(initializeDatabase(partial, sql), { code: "BCA_SCHEMA_NOT_EMPTY" });
  assert.equal(partial.writes.length, previousWrites, "Never retry or repair a partial import automatically");
  console.log("PASS: explicit schema setup, existing/partial databases protected, no destructive SQL, initialization lock, errors redacted. Database responses simulated.");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  await testInit(require("../plesk/init-db.cjs").initializeDatabase);
}
