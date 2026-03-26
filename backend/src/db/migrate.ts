#!/usr/bin/env node
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { runMigrations } from "./runner.js";

const dbPath = process.env.DB_PATH ?? "./data/crewdeck.db";

if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

console.log(`Running migrations on ${dbPath}...`);

runMigrations(db)
  .then((applied) => {
    if (applied.length === 0) {
      console.log("No new migrations to apply.");
    } else {
      console.log(`Applied ${applied.length} migration(s):`);
      for (const name of applied) {
        console.log(`  - ${name}`);
      }
    }
    db.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    db.close();
    process.exit(1);
  });
