import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { Admin, User, Conversation, sequelize } from "@workspace/db";

export type Identity = { id: string; role: "member" | "admin"; sessionId?: string };
export function accountModel(role: Identity["role"]) { return role === "admin" ? Admin : User; }
export async function publicAccount(identity: Identity) {
  const account = await accountModel(identity.role).findByPk(identity.id);
  if (!account) return null;
  const a = account.get();
  return {
    id: a.id, username: a.username, role: identity.role, phone: a.phone,
    avatarUrl: a.avatarFileId ? `/api/files/${a.avatarFileId}` : null,
  };
}
export function normalizePhone(input: string) {
  const raw = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return { credential: digits, display: /^[+]|^00/.test(raw) ? `+${digits}` : digits };
}
/**
 * Open member enrolment explicitly requested by the owner. This is NOT phone
 * ownership verification. Admin lookup/password verification stays in auth.ts.
 * The pair (name, phone) identifies a member; another phone is a separate chat.
 * Existing records and their conversations are never renamed or overwritten.
 */
export async function loginOrCreateMember(username: string, number: string) {
  const phone = normalizePhone(number);
  if (!phone) return null;
  const matches = async (user: InstanceType<typeof User>) => {
    const storedPhone = normalizePhone((user.get("phone") as string) || "");
    if (storedPhone) return storedPhone.credential === phone.credential;
    const hash = user.get("credentialHash") as string;
    return await bcrypt.compare(phone.credential, hash)
      // Preserve accounts provisioned before phone normalization was introduced.
      || (number !== phone.credential && await bcrypt.compare(number, hash));
  };
  // Reading this name's small range also restores older formatted profile
  // phones without rewriting their values or losing the existing conversation.
  const candidates = await User.findAll({ where: { username } });
  let existing: InstanceType<typeof User> | null = null;
  for (const candidate of candidates) {
    if (await matches(candidate)) { existing = candidate; break; }
  }
  return sequelize.transaction(async (transaction) => {
    let user = existing;
    if (!user) {
      const [candidate, created] = await User.findOrCreate({
        where: { username, phone: `+${phone.credential}` },
        defaults: {
          id: randomUUID(), username, phone: `+${phone.credential}`,
          credentialHash: await bcrypt.hash(phone.credential, 12), isDemo: false,
        },
        transaction,
      });
      if (!created && !await matches(candidate)) return null;
      user = candidate;
    }
    await Conversation.findOrCreate({
      where: { userId: user.get("id") },
      defaults: { id: randomUUID(), userId: user.get("id") },
      transaction,
    });
    return user;
  });
}
