import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";
import { preloadMigrations, runMigrationsSync } from "./runner.js";
import { initializePausedIssues } from "./repositories/issues.js";

// Preload migration modules at import time (top-level await)
await preloadMigrations();

export function createDb(path: string): Database.Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run all migrations synchronously (modules already preloaded)
  runMigrationsSync(db);

  return db;
}

export const db = createDb(config.dbPath);

// Initialize in-memory paused issues set from database
initializePausedIssues();
