import { exec } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "../../config.js";
import type { AgentAdapter, SpawnOptions, SessionHandle } from "../types.js";
import { shellQuote } from "../shell.js";

const execAsync = promisify(exec);

// Build a launch script using base64-encoded prompts to avoid shell escaping issues
// --dangerously-skip-permissions: required for unattended agent execution.
// TODO: Add auth middleware on agent-spawning routes before production (see index.ts).
function buildLaunchScript(prompt: string, systemPrompt?: string): string {
  const encode = (s: string) => shellQuote(Buffer.from(s).toString("base64"));
  const promptLine = `PROMPT=$(printf '%s' ${encode(prompt)} | base64 -d)`;

  if (systemPrompt) {
    const sysLine = `SYSTEM_PROMPT=$(printf '%s' ${encode(systemPrompt)} | base64 -d)`;
    return `#!/bin/bash\n${promptLine}\n${sysLine}\nexec claude --dangerously-skip-permissions --system-prompt "$SYSTEM_PROMPT" --prompt "$PROMPT"\n`;
  }
  return `#!/bin/bash\n${promptLine}\nexec claude --dangerously-skip-permissions --prompt "$PROMPT"\n`;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  async spawn(options: SpawnOptions): Promise<SessionHandle> {
    const { sessionName, workdir, prompt, systemPrompt, env = {} } = options;

    // Create detached tmux session with the given working directory
    await execAsync(`tmux new-session -d -s ${shellQuote(sessionName)} -c ${shellQuote(workdir)}`);

    // Inject environment variables into the tmux session environment
    // env keys are set internally by the backend — no user-supplied keys reach here
    for (const [key, value] of Object.entries(env)) {
      await execAsync(`tmux setenv -t ${shellQuote(sessionName)} ${shellQuote(key)} ${shellQuote(value)}`);
    }

    // Write launch script to a temp file — avoids multi-level shell escaping
    // crypto.randomUUID() — available as a global since Node 19
    // Temp script cleanup relies on the `rm -f` in the tmux command — if the session is killed
    // before execution, the file persists in /tmp until OS cleanup. File mode 0o700 limits access.
    const scriptPath = join(tmpdir(), `crewdeck-${crypto.randomUUID()}.sh`);
    await writeFile(scriptPath, buildLaunchScript(prompt, systemPrompt), { mode: 0o700 });

    // Execute the script inside the tmux pane; cleanup script after exit
    const runCmd = `bash ${shellQuote(scriptPath)}; rm -f ${shellQuote(scriptPath)}`;
    await execAsync(`tmux send-keys -t ${shellQuote(sessionName)} ${shellQuote(runCmd)} Enter`);

    return { sessionName };
  }

  async send(sessionName: string, message: string): Promise<void> {
    await execAsync(`tmux send-keys -t ${shellQuote(sessionName)} ${shellQuote(message)} Enter`);
  }

  async getOutput(sessionName: string): Promise<string> {
    // Capture current pane content (visible screen buffer)
    const { stdout } = await execAsync(
      `tmux capture-pane -t ${shellQuote(sessionName)} -p`
    );
    return stdout;
  }

  async isAlive(sessionName: string): Promise<boolean> {
    try {
      await execAsync(`tmux has-session -t ${shellQuote(sessionName)}`);
      return true;
    } catch {
      return false;
    }
  }

  async kill(sessionName: string): Promise<void> {
    // "exit" may not be handled by the claude CLI — force-kill below covers the failure case
    try {
      await execAsync(`tmux send-keys -t ${shellQuote(sessionName)} "exit" Enter`);
    } catch {
      return; // Already gone
    }

    // Wait up to agentKillTimeout for graceful shutdown
    const deadline = Date.now() + config.agentKillTimeout;
    while (Date.now() < deadline) {
      if (!(await this.isAlive(sessionName))) return;
      await new Promise<void>((r) => setTimeout(r, 200));
    }

    // Force kill if still running
    try {
      await execAsync(`tmux kill-session -t ${shellQuote(sessionName)}`);
    } catch {
      // Already gone
    }
  }
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();
