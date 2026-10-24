import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Drizzle's PostgreSQL tooling remains available for development only. The
// application runtime uses Sequelize; never construct a PG client for MySQL.
export const pool = /^postgres(?:ql)?:/.test(process.env.DATABASE_URL)
  ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
export const db = pool ? drizzle(pool, { schema }) : null;

export * from "./schema";
export * from "./models";
