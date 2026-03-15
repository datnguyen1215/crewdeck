import { describe, it, expect } from "vitest";
import { runCli } from "./helpers.js";

describe("signal command", () => {
  it("sends work-complete signal", async () => {
    const result = await runCli(["signal", "--event", "work-complete"]);
    expect(result.stdout).toContain('Signal "work-complete" sent.');
    expect(result.exitCode).toBe(0);
  });

  it("sends review-complete signal with data", async () => {
    const result = await runCli([
      "signal",
      "--event",
      "review-complete",
      "--data",
      '{"verdict":"approved"}',
    ]);
    expect(result.stdout).toContain('Signal "review-complete" sent.');
    expect(result.exitCode).toBe(0);
  });
});
