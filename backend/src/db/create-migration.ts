#!/usr/bin/env node
import { readdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "migrations");

const description = process.argv[2];

if (!description) {
  console.error("Usage: npm run migrate:create -- <description>");
  console.error("Example: npm run migrate:create -- add_user_email");
  process.exit(1);
}

// Validate description format
if (!/^[a-z][a-z0-9_]*$/.test(description)) {
  console.error(
    "Description must be lowercase alphanumeric with underscores, starting with a letter",
  );
  process.exit(1);
}

// Find next migration number
const files = readdirSync(migrationsDir);
const numbers = files
  .filter((f) => /^\d{3}_/.test(f))
  .map((f) => parseInt(f.slice(0, 3), 10));
const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 0;
const prefix = String(nextNum).padStart(3, "0");

const sqlFile = join(migrationsDir, `${prefix}_${description}.sql`);
const tsFile = join(migrationsDir, `${prefix}_${description}.ts`);

// Default to SQL file
const sqlTemplate = `-- Migration: ${prefix}_${description}
-- TODO: Add your SQL here
`;

const tsTemplate = `import type Database from "better-sqlite3";

export function run(db: Database.Database): void {
  // TODO: Implement migration
}
`;

// Check if user wants TypeScript
const useTs = process.argv.includes("--ts");

if (useTs) {
  writeFileSync(tsFile, tsTemplate);
  console.log(`Created: ${tsFile}`);
} else {
  writeFileSync(sqlFile, sqlTemplate);
  console.log(`Created: ${sqlFile}`);
}
