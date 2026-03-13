import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ENV } from "./helpers.js";

describe("getEnv", () => {
  beforeEach(() => {
    Object.assign(process.env, ENV);
  });

  afterEach(() => {
    for (const key of Object.keys(ENV)) {
      delete process.env[key];
    }
  });

  it("returns env vars when all are set", async () => {
    // Reset module to pick up env changes
    const { getEnv } = await import("../src/env.js");
    const env = getEnv();
    expect(env.apiUrl).toBe("http://localhost:3000/api/v1");
    expect(env.sessionId).toBe("session-1");
    expect(env.issueId).toBe("issue-1");
    expect(env.agentId).toBe("agent-1");
    expect(env.projectId).toBe("project-1");
  });

  it("exits with error when env vars are missing", async () => {
    delete process.env.CREWDECK_API_URL;
    delete process.env.CREWDECK_SESSION_ID;

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getEnv } = await import("../src/env.js");
    expect(() => getEnv()).toThrow("process.exit called");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("CREWDECK_API_URL"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("CREWDECK_SESSION_ID"));
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
