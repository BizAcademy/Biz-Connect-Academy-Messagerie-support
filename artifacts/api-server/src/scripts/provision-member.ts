import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { User, Conversation, sequelize } from "@workspace/db";
import { logger } from "../lib/logger";

async function main() {
  const username = process.env.MEMBER_USERNAME;
  const number = process.env.MEMBER_NUMBER;
  if (!username || !number) throw new Error("MEMBER_USERNAME and MEMBER_NUMBER required.");
  await sequelize.transaction(async (transaction) => {
    const [user] = await User.findOrCreate({ where: { username }, defaults: {
      id: randomUUID(), username, phone: process.env.MEMBER_PHONE || "",
      credentialHash: await bcrypt.hash(number, 12), isDemo: false,
    }, transaction });
    await Conversation.findOrCreate({ where: { userId: user.get("id") }, defaults: {
      id: randomUUID(), userId: user.get("id"),
    }, transaction });
  });
  logger.info("Member provisioned");
}
main().then(() => sequelize.close()).catch((err) => { logger.error({ err }, "Provision failed"); process.exitCode = 1; });
