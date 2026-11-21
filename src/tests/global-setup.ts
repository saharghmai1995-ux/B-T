/**
 * Vitest global setup — pushes the Prisma schema into a dedicated test DB
 * (never touches the dev database file).
 */

import { execSync } from "child_process";

export default function globalSetup(): void {
  process.env.DATABASE_URL = "file:./db/test-invariants.db";
  execSync("bunx prisma db push --force-reset --skip-generate", {
    env: { ...process.env, DATABASE_URL: "file:./db/test-invariants.db" },
    stdio: "pipe",
  });
}
