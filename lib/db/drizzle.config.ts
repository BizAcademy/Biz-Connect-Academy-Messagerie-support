import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}
if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL)) {
  throw new Error("Drizzle push is for PostgreSQL development only. For an EMPTY external MySQL/MariaDB database, explicitly import lib/db/mysql/initial.sql. Never run PostgreSQL migrations against MySQL.");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
