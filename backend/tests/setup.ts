import { vi, afterAll } from "vitest";

// Replace the db singleton with an in-memory instance for test isolation
vi.mock("../src/db/index.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/db/index.js")>();
  const db = mod.createDb(":memory:");
  return { ...mod, db };
});

// Stub git clone so repo tests don't hit the network
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn() };
});

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

afterAll(async () => {
  const { db } = await import("../src/db/index.js");
  db.close();
});
