import { vi, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Express } from "express";

// Create a temp directory for the test database
const tmpDir = mkdtempSync(join(tmpdir(), "crewdeck-test-"));
const testDbPath = join(tmpDir, "test.db");

// Point the db module at the temp file-based database
vi.mock("../../src/db/index.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/db/index.js")>();
  const db = mod.createDb(testDbPath);
  return {
    ...mod,
    db,
    withTransaction: <T>(fn: () => T): T => db.transaction(fn)(),
  };
});

// Mock git clone — prevents network calls during repo creation
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    exec: vi.fn(),
    execFile: vi.fn(),
    execFileSync: vi.fn(),
  };
});

// Mock GitHub repo metadata fetch — prevents network calls during project creation
vi.mock("../../src/github/repo-metadata.js", () => ({
  fetchRepoMetadata: vi.fn(async (owner: string, name: string) => ({
    name,
    description: null,
    default_branch: "main",
  })),
}));

// Mock filesystem calls used by repo cloning
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
    },
  };
});

let _app: Express;

export async function getApp(): Promise<Express> {
  if (!_app) {
    const { createApp } = await import("../../src/app.js");
    _app = createApp({ silent: true });
  }
  return _app;
}

afterAll(async () => {
  const { db } = await import("../../src/db/index.js");
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});
