import { describe, it, expect, inject } from "vitest";
import Database from "better-sqlite3";
import { runCli } from "./helpers.js";

describe("files command", () => {
  it("reports modified files and stores them in session context", async () => {
    const result = await runCli(["files", "--modified", "src/a.ts", "src/b.ts"]);
    expect(result.stdout).toContain("Reported 2 modified file(s).");
    expect(result.exitCode).toBe(0);

    const seeded = inject("seeded");
    const dbConn = new Database(inject("dbPath"), { readonly: true });
    try {
      const row = dbConn
        .prepare("SELECT context FROM Session WHERE id = ?")
        .get(seeded.sessionId) as { context: string };

      const context = JSON.parse(row.context) as { modified_files: string[] };
      expect(context.modified_files).toEqual(["src/a.ts", "src/b.ts"]);
    } finally {
      dbConn.close();
    }
  });
});
