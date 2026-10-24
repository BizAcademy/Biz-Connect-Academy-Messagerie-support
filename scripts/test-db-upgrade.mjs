import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { upgradePairIndex, upgradeMessageFeatures } = createRequire(import.meta.url)("../plesk/upgrade-db.cjs");
export async function testUpgrade() {
  function fake({ pair = false, deny = false } = {}) {
    let indexes = [{ Key_name: "username", Column_name: "username", Seq_in_index: 1, Non_unique: 0, Sub_part: null }];
    if (pair) indexes = [
      { Key_name: "bca_member_pair_unique", Column_name: "username", Seq_in_index: 1, Non_unique: 0, Sub_part: null },
      { Key_name: "bca_member_pair_unique", Column_name: "phone", Seq_in_index: 2, Non_unique: 0, Sub_part: null },
    ];
    const writes = [];
    const query = async ({ sql }) => {
      if (sql.startsWith("SHOW INDEX")) return [indexes];
      if (sql.startsWith("SELECT GET_LOCK")) return [[{ acquired: 1 }]];
      if (sql.startsWith("SELECT RELEASE_LOCK")) return [[]];
      writes.push(sql);
      if (sql.includes("ADD UNIQUE")) {
        if (deny) throw new Error("synthetic ALTER failure");
        indexes.push(
          { Key_name: "bca_member_pair_unique", Column_name: "username", Seq_in_index: 1, Non_unique: 0, Sub_part: null },
          { Key_name: "bca_member_pair_unique", Column_name: "phone", Seq_in_index: 2, Non_unique: 0, Sub_part: null },
        );
      } else if (sql.includes("DROP INDEX")) {
        assert(indexes.some((r) => r.Column_name === "phone"), "Replacement must exist before removal");
        indexes = indexes.filter((r) => r.Key_name !== "username");
      } else assert.fail("Unexpected mutation");
      return [[]];
    };
    return { query, writes };
  }
  const initial = fake();
  await upgradePairIndex(initial);
  assert.equal(initial.writes.length, 2);
  await upgradePairIndex(initial);
  assert.equal(initial.writes.length, 2, "Rerunning upgrade is a no-op");
  const ready = fake({ pair: true });
  await upgradePairIndex(ready); assert.equal(ready.writes.length, 0);
  const denied = fake({ deny: true });
  await assert.rejects(upgradePairIndex(denied));
  assert.equal(denied.writes.length, 1, "Failed replacement leaves old protection in place");
  assert(initial.writes.every((sql) => sql.startsWith("ALTER TABLE users ")));
  console.log("PASS: pair-index upgrade order, idempotence and failure preservation (simulated MySQL).");
}
await testUpgrade();
const columns = new Set(["id", "content"]);
const messageWrites = [];
const messageClient = { query: async ({ sql }) => {
  if (sql.startsWith("SHOW COLUMNS")) return [[...columns].map((Field) => ({ Field }))];
  assert(sql.startsWith("ALTER TABLE messages ADD COLUMN "), "Only additive schema changes allowed");
  const field = sql.match(/ADD COLUMN (\w+)/)[1];
  messageWrites.push(sql); columns.add(field);
  return [[]];
} };
await upgradeMessageFeatures(messageClient);
await upgradeMessageFeatures(messageClient);
assert.equal(messageWrites.length, 2, "Message columns are added exactly once, without deleting existing data");
console.log("PASS: reply/deletion schema upgrade is additive and idempotent (simulated MySQL).");
