import type Database from "better-sqlite3";
import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type MigrationModule = {
  run: (db: Database.Database) => void;
};

type MigrationFile = {
  name: string;
  path: string;
  isSql: boolean;
};

// Cache for loaded migration modules (populated by preloadMigrations)
const migrationModules = new Map<string, MigrationModule>();

function getMigrationFiles(migrationsDir: string): MigrationFile[] {
  const files = readdirSync(migrationsDir);
  return files
    .filter((f) => /^\d{3}_.*\.(sql|ts|js)$/.test(f))
    .map((f) => ({
      name: f.replace(/\.(sql|ts|js)$/, ""),
      path: join(migrationsDir, f),
      isSql: f.endsWith(".sql"),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function getAppliedMigrations(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT name FROM _migrations").all() as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

function recordMigration(db: Database.Database, name: string): void {
  db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
}

function executeMigrationSync(
  db: Database.Database,
  migration: MigrationFile,
): void {
  if (migration.isSql) {
    const sql = readFileSync(migration.path, "utf8");
    db.exec(sql);
  } else {
    // Use cached module
    const mod = migrationModules.get(migration.name);
    if (!mod) {
      throw new Error(
        `Migration module ${migration.name} not preloaded. Call preloadMigrations() first.`,
      );
    }
    mod.run(db);
  }
}

/**
 * Preload all TypeScript/JavaScript migration modules.
 * Must be called (and awaited) before runMigrations.
 */
export async function preloadMigrations(
  migrationsDir?: string,
): Promise<void> {
  const dir = migrationsDir ?? join(__dirname, "migrations");
  const migrations = getMigrationFiles(dir);

  for (const migration of migrations) {
    if (!migration.isSql && !migrationModules.has(migration.name)) {
      const mod = (await import(migration.path)) as MigrationModule;
      migrationModules.set(migration.name, mod);
    }
  }
}

/**
 * Run pending migrations synchronously.
 * For TypeScript migrations, preloadMigrations() must be called first.
 */
export function runMigrationsSync(
  db: Database.Database,
  migrationsDir?: string,
): string[] {
  const dir = migrationsDir ?? join(__dirname, "migrations");
  const migrations = getMigrationFiles(dir);
  const applied: string[] = [];

  ensureMigrationsTable(db);

  // Fix duplicate 027 prefix: rename old record so the new filename is recognized
  db.prepare(
    "UPDATE _migrations SET name = '041_global_agent_config' WHERE name = '027_global_agent_config' AND NOT EXISTS (SELECT 1 FROM _migrations WHERE name = '041_global_agent_config')",
  ).run();

  const alreadyApplied = getAppliedMigrations(db);

  // Special handling for 000_initial_schema:
  // If any migration >= 001 exists in _migrations, this is an existing DB.
  // Mark 000 as applied without executing.
  const hasExistingMigrations = Array.from(alreadyApplied).some(
    (name) => name >= "001",
  );
  const initialSchemaMigration = migrations.find((m) =>
    m.name.startsWith("000_"),
  );

  if (
    initialSchemaMigration &&
    !alreadyApplied.has(initialSchemaMigration.name)
  ) {
    if (hasExistingMigrations) {
      // Existing DB — mark 000 as applied without executing
      recordMigration(db, initialSchemaMigration.name);
      alreadyApplied.add(initialSchemaMigration.name);
    } else {
      // Fresh DB — execute 000
      executeMigrationSync(db, initialSchemaMigration);
      recordMigration(db, initialSchemaMigration.name);
      applied.push(initialSchemaMigration.name);
      alreadyApplied.add(initialSchemaMigration.name);
    }
  }

  // Run remaining migrations in order
  for (const migration of migrations) {
    if (alreadyApplied.has(migration.name)) continue;
    executeMigrationSync(db, migration);
    recordMigration(db, migration.name);
    applied.push(migration.name);
  }

  return applied;
}

/**
 * Run pending migrations asynchronously.
 * Preloads TypeScript modules automatically.
 */
export async function runMigrations(
  db: Database.Database,
  migrationsDir?: string,
): Promise<string[]> {
  await preloadMigrations(migrationsDir);
  return runMigrationsSync(db, migrationsDir);
}
