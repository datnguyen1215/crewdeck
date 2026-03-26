---
title: CrewDeck Agent Runtime
version: 0.3.0
status: draft
---

# CrewDeck — Agent Runtime

## Overview

The Agent Runtime is the abstraction layer between CrewDeck's backend and the underlying AI CLI tools. It manages spawning, communicating with, and monitoring AI agent sessions running in tmux. Claude Code is the default adapter, but the interface is designed to be CLI-tool-agnostic so that future adapters (ChatGPT CLI, Codex, etc.) can be swapped in.

## Adapter Interface

Every CLI tool adapter must implement this interface. The backend only interacts with agents through this interface — it never calls CLI tools directly.

### Methods

#### spawn

Creates a new tmux session and starts the CLI tool with the given prompt and working directory.

```
spawn(options: SpawnOptions) → SessionHandle
```

**SpawnOptions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sessionName | string | Yes | Unique tmux session name (e.g., `crewdeck-<issueId>-<agentId>`). |
| workdir | string | Yes | Absolute path to the working directory (git worktree). |
| prompt | string | Yes | The initial prompt/instruction to send to the agent. |
| systemPrompt | string | No | System prompt defining the agent's persona. How this is passed depends on the adapter (e.g., Claude Code uses `--system-prompt` flag). |
| env | Record<string, string> | No | Additional environment variables to set in the tmux session. |
| print | boolean | No | When true, runs in `--print` mode: prompt is passed as a positional arg and the process exits after printing structured output. Used by the orchestrator. |

**SessionHandle:**

| Field | Type | Description |
|-------|------|-------------|
| sessionName | string | The tmux session name. |

**Pseudocode:**

```
function spawn(options):
    create tmux session with name options.sessionName
    set working directory to options.workdir
    set environment variables from options.env
    build CLI command with adapter-specific flags
    send CLI command to tmux session
    return SessionHandle { sessionName }
```

#### send

Sends a follow-up message to an existing session. Used when resuming work (e.g., feeding review feedback to an agent).

```
send(sessionName: string, message: string) → void
```

**Pseudocode:**

```
function send(sessionName, message):
    verify tmux session exists
    send keystrokes to the tmux pane (tmux send-keys)
    the message becomes input to the running CLI tool
```

#### getOutput

Captures the current visible output from the tmux pane.

```
getOutput(sessionName: string) → string
```

**Pseudocode:**

```
function getOutput(sessionName):
    run tmux capture-pane for the session
    return captured text
```

#### isAlive

Checks whether the CLI tool process in the session is still running.

```
isAlive(sessionName: string) → boolean
```

**Pseudocode:**

```
function isAlive(sessionName):
    check if tmux session exists (tmux has-session)
    return true if session exists, false otherwise
```

#### kill

Terminates the session and cleans up.

```
kill(sessionName: string) → void
```

**Pseudocode:**

```
function kill(sessionName):
    send exit/quit command to the CLI tool
    wait briefly for graceful shutdown
    if still running, kill the tmux session forcefully
```

## Claude Code Adapter

The default adapter implementation for Claude Code CLI.

### Command Construction

When spawning a Claude Code session, the adapter constructs the CLI command. There are two modes:

**Interactive mode** (workers and reviewers — `print: false`, the default):

```
claude --dangerously-skip-permissions \
       --system-prompt "<agent system prompt>" \
       --prompt "<initial task prompt>"
```

**Print mode** (orchestrator — `print: true`):

```
claude --dangerously-skip-permissions \
       --print \
       --system-prompt "<system prompt>" \
       "<initial task prompt>"
```

In print mode `--print` is a standalone flag (it does not take the prompt as its value). The prompt is passed as a positional argument. Claude exits immediately after writing its response to stdout, which the adapter captures and parses as structured JSON.

**Notes:**
- `--dangerously-skip-permissions` is used because agents need to operate autonomously without approval prompts. The human oversight comes from CrewDeck's review pipeline instead.
- The system prompt is passed via `--system-prompt` flag to define the agent's persona.
- The initial prompt contains the task instructions, issue context, and any relevant state from the database.

### Prompt Construction

When the backend resumes an agent or sends it new work, it constructs a prompt containing all relevant context from the database:

```
function buildPrompt(issue, agent, repo, context):
    parts = []
    parts += "## Issue\n" + XML-tagged issue.title and issue.description
    parts += "## Repository\n" + repo.name + " at " + context.worktreePath
    if context.previousComments:
        parts += "## Previous Comments\n" + XML-tagged comments
    if context.feedbackComments:
        parts += "## Review Feedback to Address\n" + XML-tagged feedback
    parts += "## Instructions\n" + role info + crewdeck CLI usage
    return join(parts, "\n\n")
```

The agent system prompt is passed separately via the `--system-prompt` CLI flag, not embedded in the prompt body.

This approach means we never depend on Claude Code's session management. Every invocation gets a complete, self-contained prompt built from CrewDeck's database.

### Session Naming Convention

```
crewdeck-<issueId-short>-<agentId-short>-<role>
crewdeck-captain-<projectId-8chars>
```

Examples (8-char hex prefixes):
- `crewdeck-a1b2c3d4-e5f6g7h8-worker` — worker agent session
- `crewdeck-a1b2c3d4-i9j0k1l2-reviewer` — reviewer agent session
- `crewdeck-captain-a1b2c3d4` — persistent captain session for a project

### Detecting Completion

Completion detection differs between worker/reviewer sessions and the captain session.

#### Worker and Reviewer Sessions

Workers and reviewers run in one-shot mode (`--prompt`). Completion is detected through two complementary mechanisms:

1. **CrewDeck CLI signal (primary)** — the agent's system prompt instructs it to call `crewdeck signal --event work-complete` when it finishes its task. The CLI makes an HTTP call to the backend's internal API, which emits an event on the event bus. This is the most reliable method because the agent explicitly declares "I'm done."

2. **Process exit (fallback)** — the Agent Runtime polls `isAlive()` to detect when the Claude Code process exits. This catches cases where the agent crashes or exits without signaling.

```
Agent (in tmux)                    CrewDeck CLI              Backend Event Bus
     │                                  │                          │
     │  working...                      │                          │
     │  working...                      │                          │
     │  calls: crewdeck signal          │                          │
     │    --event work-complete  ──────→│                          │
     │                                  │  POST /internal/signal ─→│
     │                                  │                          │  emit("agent.finished")
     │  exits                           │                          │
     │                                  │                          │
```

When completion is detected (via either mechanism), the backend:
- Captures the final output.
- Stores relevant context in the Session table.
- Emits events on the event bus (`agent.finished`).
- The event bus triggers: WebSocket broadcast, Activity Logger, and the Orchestrator (which relays the event to the captain).

#### Captain Session

The captain runs as a persistent interactive session. It does not "complete" in the traditional sense. Instead:

- The captain remains idle between events, waiting for input.
- The orchestrator relays events to the captain via `tmux send-keys`.
- The captain processes the event, executes CLI commands, and returns to an idle state.
- The session only ends if explicitly killed or if the captain process crashes. On crash, the backend restores the session from saved history (see [Orchestrator Runtime](#orchestrator-runtime)).

See [Agent CLI](agent-cli.md) for the full CLI specification.

## Tmux Management

### Session Lifecycle

```
1. Backend decides an agent needs to work
      ↓
2. Runtime.spawn() creates tmux session + starts CLI tool
      ↓
3. Backend stores session info in DB (Session table)
      ↓
4. Frontend connects to output stream via WebSocket
      ↓
5. Agent works autonomously in the tmux session
      ↓
6. Adapter detects completion
      ↓
7. Backend captures output, updates DB, emits events
      ↓
8. Backend may send follow-up (Runtime.send()) or kill session (Runtime.kill())
```

### Concurrent Session Management

Multiple tmux sessions can run simultaneously, bounded by the project's max_concurrency setting. The backend tracks all active sessions and their associations:

- Which agent is in which session.
- Which issue each session is working on.
- Whether the session is for a worker or reviewer.

### Output Streaming for xterm.js

The frontend renders live terminal views using xterm.js. The data flow:

```
tmux pane → node-pty (tmux attach-session) → terminal WebSocket → frontend xterm.js
```

The backend exposes a `/terminal-ws?sessionId=<id>` WebSocket endpoint. When a client connects, the server spawns a PTY via `node-pty` running `tmux attach-session -t <tmux_session_name>`, piping raw terminal data bidirectionally between the PTY and the browser. This gives xterm.js the full ANSI escape sequences it needs for proper rendering, and supports bidirectional input so users can interact with sessions from the browser.

The `ProcessMonitor` still captures a final output snapshot via `adapter.getOutput()` when a session ends and stores it in `Session.context` for post-mortem inspection.

### Cleanup

Sessions are cleaned up when:
- The agent completes its work.
- The user manually stops a session via the API.
- The project is deleted.
- An error occurs and the session cannot recover.

Cleanup involves:
1. Killing the CLI process.
2. Destroying the tmux session.
3. Updating the Session record status to `completed` or `error`.
4. Optionally cleaning up the git worktree (if the issue is done).

## Git Worktree Management

### Creating Worktrees

When an agent starts work on an issue, the backend creates a git worktree:

```
function createWorktree(repo, issue, baseBranch):
    branchName = "crewdeck/" + issue.id-short + "-" + slugify(issue.title)
    repoPath = toContainerPath(repo.local_path)
    worktreePath = repoPath + "/.worktrees/" + branchName

    run: git -C <repoPath> worktree add -b <branchName> <worktreePath> <baseBranch>

    update issue record with branch_name, worktree_path, base_branch
    return worktreePath
```

### Base Branch Selection

The orchestrator determines the base branch:

- **Default:** The repo's default branch (e.g., `main`).
- **Dependency-aware:** If issue B depends on issue A, the orchestrator bases B's worktree on A's branch. This allows stacking changes.

### Reviewer Access

Reviewers work in the same worktree as the original agent. They examine the code and post comments but do not create separate branches. If a reviewer needs to suggest changes, they describe them in comments for the original agent to implement.

### Worktree Cleanup

Worktrees are automatically cleaned up when an issue reaches `done` status or when an issue is deleted. The cleanup is handled by an event listener (`initWorktreeCleanup()`) initialized at startup.

**Event-driven cleanup (`initWorktreeCleanup()`):**

1. Listens for `issue.status_changed` events with `to === "done"`
2. Retrieves the issue and checks for worktree info (`worktree_path`, `branch_name`, `repo_id`)
3. If the worktree path already missing from disk, clears DB fields and returns early
4. If the worktree path exists, calls `cleanupWorktree(repo, worktreePath, branchName, true)` to remove it
5. **Always clears** `worktree_path` and `branch_name` fields on the issue record (via `finally` block) regardless of cleanup success
6. Logs warnings on failure but continues — cleanup errors are non-fatal

**Synchronous cleanup on deletion:**

When an issue is deleted via `DELETE /issues/:issueId` or `POST /issues/:issueId/discard`, cleanup runs synchronously before database deletion:
- Checks if worktree path exists on disk
- Calls `cleanupWorktree()` if present
- Logs warnings on failure but continues with deletion
- Prevents worktree leaks when issues are removed

**Implementation guarantees:**
- Database fields are always cleared when status reaches `done`, even if git cleanup fails
- This prevents DB from pointing to broken or partially-cleaned worktree state
- Early exit optimization when path already gone (no unnecessary git operations)
- Error handling ensures cleanup failures don't block issue deletion or status transitions

```
function cleanupWorktree(repo, worktreePath, branchName, deleteBranch):
    repoPath = toContainerPath(repo.local_path)
    run: git -C <repoPath> worktree remove <worktreePath>
    if deleteBranch:
        git -C <repoPath> branch -d <branchName>
```

## Session Context Storage

### Purpose

CrewDeck owns all session context rather than relying on CLI tool session management. This enables:

- CLI tool agnosticism — any adapter can be used.
- Precise context control — only relevant state is fed to agents.
- Crash recovery — sessions can be reconstructed from the database.
- Audit trail — all context is stored and queryable.

### What Gets Stored

The Session.context field (JSON) stores:

```json
{
  "conversation_summary": "Brief summary of what happened in this session",
  "decisions_made": [
    "Chose to refactor auth middleware instead of patching",
    "Split the migration into two steps"
  ],
  "files_modified": [
    "src/auth/middleware.ts",
    "src/db/migrations/003.sql"
  ],
  "pending_questions": [
    "Should the old endpoint be deprecated or removed?"
  ],
  "last_output_snapshot": "Last N lines of terminal output"
}
```

### When Context Is Updated

- After each agent completion (worker finishes, reviewer finishes).
- The backend parses relevant information from the agent's output and comments.
- This parsed context is used to construct the next prompt when resuming or handing off.

## Orchestrator Runtime

The orchestrator is a thin event relay between the backend event bus and a persistent captain tmux session. It does not call Claude directly or parse agent output. All decision-making happens inside the captain session.

### Architecture

```
Backend Event Bus          Orchestrator (relay)         Captain (tmux session)
     │                          │                              │
     │  event fired ──────────→ │                              │
     │                          │  format event text           │
     │                          │  tmux send-keys ───────────→ │
     │                          │                              │  reads event
     │                          │                              │  decides action
     │                          │                              │  runs: crewdeck assign ...
     │                          │                              │  runs: crewdeck route-review ...
     │  ← event bus updated ────│←── crewdeck CLI calls ──────│
     │                          │                              │  returns to idle
```

### Captain Session

The captain is a persistent interactive Claude Code session running in tmux. Unlike worker/reviewer sessions that use one-shot `--prompt` mode, the captain runs in interactive mode and persists across multiple issues.

**Session name:** `crewdeck-captain-<projectId-8chars>`

**Spawning:**

```
claude --dangerously-skip-permissions \
       --system-prompt "<captain system prompt>"
```

The captain is spawned without `--prompt` so it starts in interactive mode, waiting for input. The system prompt defines the captain's persona, available CLI commands, and decision-making guidelines.

### Captain Requirement

The orchestrator requires a designated **captain** agent. If no agent in the crew has `is_captain = true`, the orchestrator skips processing entirely until one is set. The captain's system prompt is passed via the `--system-prompt` flag when spawning the session.

### Event Relay

The orchestrator is event-driven. When an event fires, the orchestrator formats it as text and sends it to the captain session via `tmux send-keys`.

| Event | What gets relayed to the captain |
|-------|----------------------------------|
| Issue approved | Issue details, priority, available agents, project state |
| Agent finished work | Issue status, agent output summary, review routing options |
| Review completed | Review outcome, reviewer comments, approve/reject decision |
| Max rounds reached | Escalation context, round history |
| New comment from user | Comment content, issue context |
| User captain message | User's direct message to the captain |

The orchestrator does not interpret the captain's response. The captain acts by calling CrewDeck CLI commands directly from within its tmux session.

### Captain CLI Commands

Instead of returning structured JSON, the captain executes CLI commands to take action:

- `crewdeck assign --issue <id> --agent <id>` — assign an agent to an issue.
- `crewdeck route-review --issue <id>` — send an issue to the next reviewer.
- `crewdeck escalate --issue <id>` — flag an issue for human attention.
- `crewdeck create-issue --title "..." --description "..."` — propose a new issue.
- `crewdeck reorder --issue <id> --priority <n>` — change issue priority.

Each CLI command makes an HTTP call to the backend's internal API, which updates the database and emits events on the event bus. The captain can run multiple commands in sequence when handling a single event.

### Session Persistence and Recovery

The captain session persists across multiple events and issues. To handle crashes or restarts:

- **History saved to DB** — the captain's conversation history is periodically saved to the database.
- **Session restore** — when a captain session is lost (process crash, container restart), the orchestrator detects the missing session via `isAlive()` and respawns it. The saved history is restored into the new session so the captain retains context from prior decisions.
- **CaptainMessage records** — the backend stores a `CaptainMessage` record for each event relay and captain action. This builds the captain chat timeline visible to the user in the frontend.

## Future Adapters

To add support for a new CLI tool:

1. Implement the adapter interface (spawn, send, getOutput, isAlive, kill).
2. Handle tool-specific command construction (flags, prompt passing).
3. Handle tool-specific completion detection.
4. Register the adapter in the runtime configuration.

The rest of the system (backend, frontend, orchestrator, session management) requires no changes.
