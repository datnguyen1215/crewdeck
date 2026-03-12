import { vi, afterAll } from "vitest";

// Replace the db singleton with an in-memory instance for test isolation
vi.mock("../src/db/index.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/db/index.js")>();
  const db = mod.createDb(":memory:");
  return { ...mod, db };
});

afterAll(async () => {
  const { db } = await import("../src/db/index.js");
  db.close();
});
