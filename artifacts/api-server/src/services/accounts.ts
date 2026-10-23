import bcrypt from "bcryptjs";
import { Admin, User } from "@workspace/db";

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
/**
 * Replace this isolated verifier with the Academy API when its contract is
 * available. Local membership records must be provisioned by a trusted operator.
 * The Academy number is treated as a credential, not a public identifier.
 */
export async function verifyAcademyMember(username: string, number: string) {
  const user = await User.findOne({ where: { username } });
  if (!user || !await bcrypt.compare(number, user.get("credentialHash") as string)) return null;
  return user;
}
