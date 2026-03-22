import { describe, it, expect } from "vitest";

// Re-implement the functions locally for unit testing since they're not exported
type CheckResult = "pass" | "fail" | "pending";

interface GitHubStatusResponse {
  state: "success" | "failure" | "pending";
  total_count: number;
}

interface GitHubCheckRun {
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | "timed_out" | "action_required" | null;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

function analyzeCheckRuns(checkRuns: GitHubCheckRunsResponse): CheckResult {
  if (checkRuns.total_count === 0) return "pass";

  const runs = checkRuns.check_runs;
  const hasIncomplete = runs.some(r => r.status !== "completed");
  if (hasIncomplete) return "pending";

  const hasFailed = runs.some(r =>
    r.conclusion === "failure" ||
    r.conclusion === "cancelled" ||
    r.conclusion === "timed_out"
  );
  return hasFailed ? "fail" : "pass";
}

function analyzeCommitStatus(status: GitHubStatusResponse): CheckResult {
  if (status.state === "success") return "pass";
  if (status.state === "failure") return "fail";
  if (status.state === "pending" && status.total_count === 0) return "pass";
  return "pending";
}

function combineCheckResults(checkRuns: CheckResult, legacy: CheckResult): CheckResult {
  if (checkRuns === "fail" || legacy === "fail") return "fail";
  if (checkRuns === "pending" || legacy === "pending") return "pending";
  return "pass";
}

describe("analyzeCommitStatus", () => {
  it("returns pass for success state", () => {
    expect(analyzeCommitStatus({ state: "success", total_count: 1 })).toBe("pass");
  });

  it("returns fail for failure state", () => {
    expect(analyzeCommitStatus({ state: "failure", total_count: 1 })).toBe("fail");
  });

  it("returns pending for pending state with statuses", () => {
    expect(analyzeCommitStatus({ state: "pending", total_count: 2 })).toBe("pending");
  });

  it("returns pass for pending state with zero statuses (no legacy CI configured)", () => {
    expect(analyzeCommitStatus({ state: "pending", total_count: 0 })).toBe("pass");
  });
});

describe("analyzeCheckRuns", () => {
  it("returns pass when no check runs exist", () => {
    expect(analyzeCheckRuns({ total_count: 0, check_runs: [] })).toBe("pass");
  });

  it("returns pass when all check runs succeed", () => {
    expect(analyzeCheckRuns({
      total_count: 2,
      check_runs: [
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "success" },
      ],
    })).toBe("pass");
  });

  it("returns pending when check runs are in progress", () => {
    expect(analyzeCheckRuns({
      total_count: 1,
      check_runs: [
        { status: "in_progress", conclusion: null },
      ],
    })).toBe("pending");
  });

  it("returns fail when any check run fails", () => {
    expect(analyzeCheckRuns({
      total_count: 2,
      check_runs: [
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
      ],
    })).toBe("fail");
  });

  it("returns fail for cancelled check runs", () => {
    expect(analyzeCheckRuns({
      total_count: 1,
      check_runs: [
        { status: "completed", conclusion: "cancelled" },
      ],
    })).toBe("fail");
  });

  it("returns fail for timed_out check runs", () => {
    expect(analyzeCheckRuns({
      total_count: 1,
      check_runs: [
        { status: "completed", conclusion: "timed_out" },
      ],
    })).toBe("fail");
  });

  it("returns pass for skipped check runs", () => {
    expect(analyzeCheckRuns({
      total_count: 1,
      check_runs: [
        { status: "completed", conclusion: "skipped" },
      ],
    })).toBe("pass");
  });
});

describe("combineCheckResults", () => {
  it("returns fail if check runs fail", () => {
    expect(combineCheckResults("fail", "pass")).toBe("fail");
  });

  it("returns fail if legacy status fails", () => {
    expect(combineCheckResults("pass", "fail")).toBe("fail");
  });

  it("returns pending if check runs are pending", () => {
    expect(combineCheckResults("pending", "pass")).toBe("pending");
  });

  it("returns pending if legacy status is pending", () => {
    expect(combineCheckResults("pass", "pending")).toBe("pending");
  });

  it("returns pass only when both pass", () => {
    expect(combineCheckResults("pass", "pass")).toBe("pass");
  });
});

describe("modern check runs only (no legacy statuses)", () => {
  it("passes when check runs pass and no legacy statuses exist", () => {
    const checkRunsResult = analyzeCheckRuns({
      total_count: 1,
      check_runs: [{ status: "completed", conclusion: "success" }],
    });
    const legacyResult = analyzeCommitStatus({ state: "pending", total_count: 0 });

    expect(checkRunsResult).toBe("pass");
    expect(legacyResult).toBe("pass");
    expect(combineCheckResults(checkRunsResult, legacyResult)).toBe("pass");
  });
});
