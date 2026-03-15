import { describe, it, expect, inject } from "vitest";
import Database from "better-sqlite3";
import { runCli } from "./helpers.js";

describe("comment command", () => {
  it("posts a comment and stores it in the database", async () => {
    const result = await runCli(["comment", "--message", "test comment"]);
    expect(result.stdout).toContain("Comment posted.");
    expect(result.exitCode).toBe(0);

    const seeded = inject("seeded");
    const dbConn = new Database(inject("dbPath"), { readonly: true });
    try {
      const row = dbConn
        .prepare(
          "SELECT author_type, content FROM Comment WHERE issue_id = ? ORDER BY rowid DESC LIMIT 1",
        )
        .get(seeded.issueId) as { author_type: string; content: string };

      expect(row.author_type).toBe("agent");
      expect(row.content).toBe("test comment");
    } finally {
      dbConn.close();
    }
  });
});
