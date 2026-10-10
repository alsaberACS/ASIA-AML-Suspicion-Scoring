import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// An idle pooled connection can be closed from the server side (database
// maintenance, failover: "terminating connection due to administrator
// command"). pg surfaces that as an 'error' event on the pool; without a
// listener Node treats it as an unhandled error and the whole API process
// exits. The pool discards the dead client on its own, so logging is all
// that is needed here.
pool.on("error", (err) => {
  console.error("[db] idle connection error (client discarded):", err.message);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
