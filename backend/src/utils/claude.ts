import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Run claude in --print mode and return stdout.
// Use execFile to pass the prompt as a direct argument — no shell involved, no encoding needed.
// --dangerously-skip-permissions is intentional: the orchestrator needs unrestricted tool access
// (git, crewdeck CLI, etc). The risk is accepted and mitigated by XML-escaping all user-controlled
// content in prompts so injection cannot redirect Claude's actions.
export async function callClaude(prompt: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "claude",
    ["--dangerously-skip-permissions", "--print", "--prompt", prompt],
    { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }
  );
  return stdout;
}
