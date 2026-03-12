import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterAll } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

// In-memory DB for tests
export const testDb = new Database(":memory:");
testDb.pragma("foreign_keys = ON");

const schema = readFileSync(join(__dirname, "../src/db/schema.sql"), "utf8");
testDb.exec(schema);

afterAll(() => {
  testDb.close();
});
