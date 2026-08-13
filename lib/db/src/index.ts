import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/sovereign_agent";

// Initialize PostgreSQL client connection pool
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Initialize Drizzle ORM instance with full schema mapping
export const db = drizzle(client, { schema });

// Re-export all tables, enums, and types from schema
export * from "./schema";

/**
 * Graceful database connection shutdown helper
 */
export async function closeDatabaseConnection(): Promise<void> {
  await client.end();
}