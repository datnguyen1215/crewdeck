import { vi, beforeEach, afterEach } from "vitest";

export const ENV = {
  CREWDECK_API_URL: "http://localhost:3000/api/v1",
  CREWDECK_SESSION_ID: "session-1",
  CREWDECK_ISSUE_ID: "issue-1",
  CREWDECK_AGENT_ID: "agent-1",
  CREWDECK_PROJECT_ID: "project-1",
};

export function setupCommandTest(defaultFetchBody: object = { ok: true }) {
  const mocks = {
    fetchMock: undefined as unknown as ReturnType<typeof vi.fn>,
    exitSpy: undefined as unknown as ReturnType<typeof vi.spyOn<typeof process, "exit">>,
    errorSpy: undefined as unknown as ReturnType<typeof vi.spyOn<typeof console, "error">>,
  };

  beforeEach(() => {
    Object.assign(process.env, ENV);

    mocks.fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => defaultFetchBody,
    });
    vi.stubGlobal("fetch", mocks.fetchMock);

    mocks.exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    mocks.errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of Object.keys(ENV)) delete process.env[key];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  return mocks;
}
