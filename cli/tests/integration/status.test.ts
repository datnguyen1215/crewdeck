import { describe, it, expect } from "vitest";
import { runCli } from "./helpers.js";

describe("status command", () => {
  it("sets agent status to active", async () => {
    const result = await runCli(["status", "--state", "active"]);
    expect(result.stdout).toContain('Status set to "active".');
    expect(result.exitCode).toBe(0);
  });
});
