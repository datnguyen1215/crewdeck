import { exec } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { config } from "../../config.js";
import type { AgentAdapter, SpawnOptions, SessionHandle } from "../types.js";
import { shellQuote } from "../shell.js";

const execAsync = promisify(exec);

// Calculate how many Down arrow presses are needed to reach a target option.
// The TUI uses ❯ to mark the currently selected option and arrow keys to navigate.
function getArrowPresses(output: string, label: string): number {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const lines = output.split("\n");
  let targetIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`\\d+\\.\\s*${escaped}`).test(lines[i])) { targetIdx = i; break; }
  }
  if (targetIdx < 0) return 0;
  // Find the ❯ marker closest to (and at or before) the target line
  let selectedIdx = -1;
  for (let i = targetIdx; i >= 0; i--) {
    if (lines[i].includes("❯")) { selectedIdx = i; break; }
  }
  if (selectedIdx < 0) return 0;
  return targetIdx - selectedIdx;
}

// Build a launch script using base64-encoded prompts to avoid shell escaping issues
// --dangerously-skip-permissions: required for unattended agent execution.
// TODO: Add auth middleware on agent-spawning routes before production (see index.ts).
interface LaunchScriptOptions {
  prompt: string;
  env: Record<string, string>;
  systemPrompt?: string;
  print?: boolean;
  claudeSessionId?: string;
}

function buildLaunchScript(opts: LaunchScriptOptions): string {
  const { prompt, env, systemPrompt, print, claudeSessionId } = opts;
  const encode = (s: string) => shellQuote(Buffer.from(s).toString("base64"));
  const promptLine = `PROMPT=$(printf '%s' ${encode(prompt)} | base64 -d)`;
  const promptArg = '"$PROMPT"';

  const flags: string[] = ["--dangerously-skip-permissions"];
  if (print) flags.push("--print");
  if (claudeSessionId)
    flags.push(`--session-id ${shellQuote(claudeSessionId)}`);

  // Put the CLI dist directory on PATH so spawned agents can run `crewdeck`.
  const cliDistPath = resolve(config.cliDir, "dist");

  // Export env vars directly in the script so claude inherits them.
  // Clear CLAUDECODE to prevent nested-agent detection from forcing the permission prompt.
  const envLines = [
    `export PATH=${shellQuote(cliDistPath)}:"$PATH"`,
    "export CLAUDECODE=",
  ];
  for (const [key, value] of Object.entries(env)) {
    envLines.push(`export ${key}=${shellQuote(value)}`);
  }
  const envBlock = envLines.join("\n");

  const flagStr = flags.join(" ");
  if (systemPrompt) {
    const sysLine = `SYSTEM_PROMPT=$(printf '%s' ${encode(systemPrompt)} | base64 -d)`;
    return `#!/bin/bash\n${envBlock}\n${promptLine}\n${sysLine}\nexec claude ${flagStr} --system-prompt "$SYSTEM_PROMPT" ${promptArg}\n`;
  }
  return `#!/bin/bash\n${envBlock}\n${promptLine}\nexec claude ${flagStr} ${promptArg}\n`;
}

export class ClaudeCodeAdapter implements AgentAdapter {
  async spawn(options: SpawnOptions): Promise<SessionHandle> {
    const {
      sessionName,
      workdir,
      prompt,
      systemPrompt,
      env = {},
      print,
      claudeSessionId,
    } = options;

    // Create detached tmux session with the given working directory
    await execAsync(
      `tmux new-session -d -s ${shellQuote(sessionName)} -c ${shellQuote(workdir)}`,
    );

    // Write launch script to a temp file — avoids multi-level shell escaping.
    // Env vars are exported directly in the script so claude inherits them.
    const scriptPath = join(tmpdir(), `crewdeck-${crypto.randomUUID()}.sh`);
    await writeFile(
      scriptPath,
      buildLaunchScript({ prompt, env, systemPrompt, print, claudeSessionId }),
      { mode: 0o700 },
    );

    // Execute the script inside the tmux pane; cleanup script after exit
    const runCmd = `bash ${shellQuote(scriptPath)}; rm -f ${shellQuote(scriptPath)}`;
    await execAsync(
      `tmux send-keys -t ${shellQuote(sessionName)} ${shellQuote(runCmd)} Enter`,
    );

    // Auto-accept interactive prompts (trust folder, bypass permissions) by
    // polling capture-pane and sending the appropriate key when detected.
    if (!print) {
      this.waitForStartupPrompts(sessionName).catch(() => {});
    }

    return { sessionName };
  }

  private async waitForStartupPrompts(sessionName: string): Promise<void> {
    const sn = shellQuote(sessionName);
    const deadline = Date.now() + 30_000;
    const interval = 500;
    let handledTrust = false;
    let handledBypass = false;

    while (Date.now() < deadline) {
      if (handledTrust && handledBypass) return;
      await new Promise<void>((r) => setTimeout(r, interval));
      try {
        const { stdout } = await execAsync(`tmux capture-pane -t ${sn} -p`);

        // Trust prompt — navigate to "Yes, proceed" and confirm
        if (!handledTrust && stdout.includes("trust this folder")) {
          const presses = getArrowPresses(stdout, "Yes, proceed");
          for (let i = 0; i < presses; i++) {
            await execAsync(`tmux send-keys -t ${sn} Down`);
            await new Promise<void>((r) => setTimeout(r, 150));
          }
          await execAsync(`tmux send-keys -t ${sn} Enter`);
          handledTrust = true;
          continue;
        }

        // Bypass permissions prompt — navigate to "Yes, I accept" and confirm
        if (!handledBypass && stdout.includes("Yes, I accept")) {
          const presses = getArrowPresses(stdout, "Yes, I accept");
          for (let i = 0; i < presses; i++) {
            await execAsync(`tmux send-keys -t ${sn} Down`);
            await new Promise<void>((r) => setTimeout(r, 150));
          }
          await execAsync(`tmux send-keys -t ${sn} Enter`);
          handledBypass = true;
          continue;
        }
      } catch {
        return; // Session gone
      }
    }
  }

  async send(sessionName: string, message: string): Promise<void> {
    const sn = shellQuote(sessionName);
    // Send text first, then Enter separately after a short delay.
    // Claude's TUI needs time to render the text before Enter can submit it.
    await execAsync(`tmux send-keys -t ${sn} ${shellQuote(message)}`);
    await new Promise<void>((r) => setTimeout(r, 200));
    await execAsync(`tmux send-keys -t ${sn} Enter`);
  }

  async getOutput(sessionName: string): Promise<string> {
    // Capture current pane content (visible screen buffer)
    const { stdout } = await execAsync(
      `tmux capture-pane -t ${shellQuote(sessionName)} -p`,
    );
    return stdout;
  }

  async isAlive(sessionName: string): Promise<boolean> {
    try {
      await execAsync(`tmux has-session -t ${shellQuote(sessionName)}`);
    } catch {
      return false;
    }

    // The tmux session exists, but the agent process inside it may have exited
    // (leaving a bare shell). Check if the pane's shell has any child processes.
    try {
      const sn = shellQuote(sessionName);
      const { stdout } = await execAsync(
        `tmux list-panes -t ${sn} -F '#{pane_pid}'`,
      );
      const panePid = stdout.trim().split("\n")[0];
      if (!panePid) return false;
      const { stdout: children } = await execAsync(`pgrep -P ${panePid}`);
      return children.trim().length > 0;
    } catch {
      // pgrep exits 1 when no children found
      return false;
    }
  }

  async kill(sessionName: string): Promise<void> {
    // "exit" may not be handled by the claude CLI — force-kill below covers the failure case
    try {
      await execAsync(
        `tmux send-keys -t ${shellQuote(sessionName)} "exit" Enter`,
      );
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
