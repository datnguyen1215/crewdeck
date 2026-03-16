---
title: CrewDeck Agent Runtime
version: 0.2.0
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
```

Examples (8-char hex prefixes):
- `crewdeck-a1b2c3d4-e5f6g7h8-worker`
- `crewdeck-a1b2c3d4-i9j0k1l2-reviewer`
- `crewdeck-orchestrator-<projectId-8chars>`

### Detecting Completion

Completion is detected through two complementary mechanisms:

1. **CrewDeck CLI signal (primary)** — the agent's system prompt instructs it to call `crewdeck signal --event work-complete` when it finishes its task. The CLI makes an HTTP call to the backend's internal API, which emits an event on the event bus. This is the most reliable method because the agent explicitly declares "I'm done."

2. **Process exit (fallback)** — the Agent Runtime polls `isAlive()` to detect when the Claude Code process exits. This catches cases where the agent crashes or exits without signaling. Claude Code is invoked with `--prompt` (single prompt mode) so it exits after completing the task.

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
- The event bus triggers: WebSocket broadcast, Activity Logger, Orchestrator Manager.

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
tmux pane → adapter.getOutput() → backend WebSocket → frontend xterm.js
```

The backend captures tmux pane output via `adapter.getOutput()` and broadcasts it via the `session.output` WebSocket event. The `ProcessMonitor` also captures a final output snapshot when a session ends and stores it in `Session.context`.

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

Worktrees are cleaned up when an issue reaches `done` status:

```
function cleanupWorktree(repo, worktreePath, branchName):
    repoPath = toContainerPath(repo.local_path)
    run: git -C <repoPath> worktree remove <worktreePath>
    optionally: git -C <repoPath> branch -d <branchName>
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

The orchestrator is a special case of the agent runtime. It follows the same adapter interface but differs in:

### How the Orchestrator Runs

The orchestrator uses `adapter.spawn()` with `print: true`. Each invocation creates a tmux session, runs Claude in `--print` mode (exits after printing its JSON response), and the backend polls in a loop — capturing output with `getOutput()` each iteration so the last successful capture is retained when the pane disappears (once `isAlive()` returns false, the tmux pane is gone and `capture-pane` fails). The parsed JSON action comes from that last captured output. This means each orchestrator decision is a short-lived tmux session rather than a long-running interactive one.

The `session.started` event emitted for orchestrator sessions omits `agent_id` and `issue_id` (both are optional in this event) since orchestrator sessions are not tied to a specific agent or issue.

### Session Persistence

- The orchestrator has one long-lived Session record per project.
- It is not always running — it is resumed on events.
- Its context field stores the orchestrator's understanding of project state, priorities, and pending decisions.

### Event-Driven Resumption

The backend resumes the orchestrator when these events occur:

| Event | What the orchestrator does |
|-------|---------------------------|
| Issue approved | Analyze priority, decide assignment, update queue |
| Agent finished work | Route to reviewers, update issue status |
| Review completed | Check if all reviewers approved, route back to agent or mark ready |
| Max rounds reached | Flag for human escalation |
| New comment from user | Re-evaluate priorities or adjust approach |
| User captain message | Re-evaluate based on user direction sent via the captain chat |

### Captain Requirement

The orchestrator requires a designated **captain** agent. If no agent in the crew has `is_captain = true`, the orchestrator skips processing entirely until one is set. The captain's system prompt is passed as the system prompt when invoking Claude, defining the orchestrator's AI persona.

### Orchestrator Prompt Construction

When resuming the orchestrator, the backend builds a prompt containing:

```
function buildOrchestratorPrompt(project, event):
    prompt = ""
    prompt += "## Project State\n"
    prompt += "Open issues: " + list of open issues with priorities
    prompt += "In-progress issues: " + list with assigned agents
    prompt += "Available agents: " + list of idle agents
    prompt += "Concurrency: " + current active / max_concurrency
    prompt += "\n## Event\n" + description of what triggered this resumption
    prompt += "\n## Crew\n" + list of agents with names, titles, descriptions, and [CAPTAIN] tag if applicable
    prompt += "\n## Instructions\n"
    prompt += "Decide what action to take based on the event and current state."
    prompt += "Respond with a structured action (assign, route_review, escalate, create_draft_issue, etc.)"
    return prompt
```

### Orchestrator Output Parsing

The orchestrator is prompted to respond in **structured JSON format**. The backend parses the JSON to extract actions:

```json
{
  "action": "assign",
  "params": {
    "issue_id": "uuid",
    "agent_id": "uuid"
  },
  "reasoning": "Alice's title and description best match the backend requirements of this issue"
}
```

**Supported actions:**

- **assign** — assign an agent to an issue.
- **route_review** — send an issue to the next reviewer.
- **escalate** — flag an issue for human attention.
- **create_draft_issue** — propose a new issue (enters Draft status).
- **reorder** — change issue priorities.
- **no_action** — nothing to do right now.

The backend validates the JSON structure, executes the action, updates the database, and emits events on the event bus. The event bus then triggers WebSocket broadcasts, activity logging, and any follow-up processing.

After executing the action, the backend stores a `CaptainMessage` record containing the orchestrator's reasoning and the action taken. This builds the captain chat timeline visible to the user.

## Future Adapters

To add support for a new CLI tool:

1. Implement the adapter interface (spawn, send, getOutput, isAlive, kill).
2. Handle tool-specific command construction (flags, prompt passing).
3. Handle tool-specific completion detection.
4. Register the adapter in the runtime configuration.

The rest of the system (backend, frontend, orchestrator, session management) requires no changes.
