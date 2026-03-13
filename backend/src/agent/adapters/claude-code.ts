import { exec } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "../../config.js";
import type { AgentAdapter, SpawnOptions, SessionHandle, Unsubscribe } from "../types.js";

const execAsync = promisify(exec);

// POSIX single-quote escaping for shell arguments
export function shellQuote(str: string): string {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

// Build a launch script using base64-encoded prompts to avoid shell escaping issues
function buildLaunchScript(prompt: string, systemPrompt?: string): string {
  const promptB64 = Buffer.from(prompt).toString("base64");
  // Decode prompt from base64 to avoid escaping issues
  const promptLine = `PROMPT=$(printf '%s' ${shellQuote(promptB64)} | base64 -d)`;

  if (systemPrompt) {
    const systemB64 = Buffer.from(systemPrompt).toString("base64");
    // --dangerously-skip-permissions: intentional for unattended agent execution; access is gated by auth on agent-spawning routes
    return `#!/bin/bash\n${promptLine}\nSYSTEM_PROMPT=$(printf '%s' ${shellQuote(systemB64)} | base64 -d)\nexec claude --dangerously-skip-permissions --system-prompt "$SYSTEM_PROMPT" --prompt "$PROMPT"\n`;
  }
  // NOTE: --dangerously-skip-permissions is required for unattended agent execution. Auth gates access to agent spawning.
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

    // Capture pane ID and shell PID before sending the command
    const { stdout: paneIdRaw } = await execAsync(
      `tmux display-message -t ${shellQuote(sessionName)} -p '#{pane_id}'`
    );
    const { stdout: pidRaw } = await execAsync(
      `tmux display-message -t ${shellQuote(sessionName)} -p '#{pane_pid}'`
    );

    // Write launch script to a temp file — avoids multi-level shell escaping
    // crypto.randomUUID() — available as a global since Node 19
    // Temp script cleanup relies on the `rm -f` in the tmux command — if the session is killed
    // before execution, the file persists in /tmp until OS cleanup. File mode 0o700 limits access.
    const scriptPath = join(tmpdir(), `crewdeck-${crypto.randomUUID()}.sh`);
    await writeFile(scriptPath, buildLaunchScript(prompt, systemPrompt), { mode: 0o700 });

    // Execute the script inside the tmux pane; cleanup script after exit
    const runCmd = `bash ${shellQuote(scriptPath)}; rm -f ${shellQuote(scriptPath)}`;
    await execAsync(`tmux send-keys -t ${shellQuote(sessionName)} ${shellQuote(runCmd)} Enter`);

    return {
      sessionName,
      paneId: paneIdRaw.trim(),
      pid: parseInt(pidRaw.trim(), 10),
    };
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

  streamOutput(sessionName: string, callback: (chunk: string) => void): Unsubscribe {
    let lastOutput = "";
    const timer = setInterval(async () => {
      try {
        // -S - captures full scrollback history (not just the visible pane),
        // so the buffer is append-only and callers receive the complete output.
        const { stdout: current } = await execAsync(
          `tmux capture-pane -t ${shellQuote(sessionName)} -p -S -`
        );
        if (current !== lastOutput) {
          callback(current);
        }
        lastOutput = current;
      } catch {
        // Session is gone — stop polling
        clearInterval(timer);
      }
    }, config.tmuxPollInterval);

    return () => clearInterval(timer);
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
