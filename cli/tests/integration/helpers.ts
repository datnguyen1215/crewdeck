import { execFile } from "child_process";
import { resolve } from "path";
import { inject } from "vitest";

const CLI_ENTRY = resolve(__dirname, "../../dist/index.js");

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCli(args: string[]): Promise<CliResult> {
  const seeded = inject("seeded");
  const baseUrl = inject("baseUrl");

  return new Promise((resolve) => {
    const child = execFile("node", [CLI_ENTRY, ...args], {
      env: {
        ...process.env,
        CREWDECK_API_URL: `${baseUrl}/api/v1`,
        CREWDECK_SESSION_ID: seeded.sessionId,
        CREWDECK_ISSUE_ID: seeded.issueId,
        CREWDECK_AGENT_ID: seeded.agentId,
        CREWDECK_PROJECT_ID: seeded.projectId,
      },
      timeout: 10_000,
    }, (error, stdout, stderr) => {
      let exitCode = child.exitCode ?? 0;
      if (error) {
        if (error.killed) exitCode = 1;
        else if (typeof error.code === "number") exitCode = error.code;
        else if (exitCode === 0) exitCode = 1;
      }
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode,
      });
    });
  });
}
