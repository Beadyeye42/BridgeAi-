import { defineConfig } from "prisma/config";
import { loadEnvFile } from "node:process";

// Next.js uses .env.local for local secrets, while the Prisma CLI only reads
// process.env when a Prisma config file is present. Load the same local file
// without overriding variables supplied by Vercel or the calling shell.
try {
  loadEnvFile(".env.local");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
