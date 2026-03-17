import { spawn } from "node:child_process";

// Run claude in --print mode and return stdout.
// Uses spawn instead of execFile because the claude CLI doesn't flush/close
// stdout properly with execFile's buffered I/O.
// --dangerously-skip-permissions is intentional: the orchestrator needs unrestricted tool access
// (git, crewdeck CLI, etc). The risk is accepted and mitigated by XML-escaping all user-controlled
// content in prompts so injection cannot redirect Claude's actions.
export async function callClaude(prompt: string, opts?: { systemPrompt?: string }): Promise<string> {
  const args = ["--dangerously-skip-permissions", "--print"];
  if (opts?.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }
  args.push(prompt);

  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("claude CLI timed out after 120s"));
    }, 120_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
