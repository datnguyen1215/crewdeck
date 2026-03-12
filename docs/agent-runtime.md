---
title: CrewDeck Agent Runtime
version: 0.1.0
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

**SessionHandle:**

| Field | Type | Description |
|-------|------|-------------|
| sessionName | string | The tmux session name. |
| paneId | string | The tmux pane ID for output capture. |
| pid | number | Process ID of the CLI tool. |

**Pseudocode:**

```
function spawn(options):
    create tmux session with name options.sessionName
    set working directory to options.workdir
    set environment variables from options.env
    build CLI command with adapter-specific flags
    send CLI command to tmux session
    capture pane ID and process ID
    return SessionHandle
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

#### streamOutput

Continuously streams output from the tmux pane. Used for the xterm.js live terminal view.

```
streamOutput(sessionName: string, callback: (chunk: string) → void) → Unsubscribe
```

**Pseudocode:**

```
function streamOutput(sessionName, callback):
    start a polling loop or pipe tmux output
    on each new chunk of output:
        call callback(chunk)
    return function that stops the stream
```

#### isAlive

Checks whether the CLI tool process in the session is still running.

```
isAlive(sessionName: string) → boolean
```

**Pseudocode:**

```
function isAlive(sessionName):
    check if tmux session exists
    check if the CLI process (pid) is still running
    return true if both conditions are met
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

When spawning a Claude Code session, the adapter constructs the CLI command:

```
claude --dangerously-skip-permissions \
       --system-prompt "<agent system prompt>" \
       --prompt "<initial task prompt>"
```

**Notes:**
- `--dangerously-skip-permissions` is used because agents need to operate autonomously without approval prompts. The human oversight comes from CrewDeck's review pipeline instead.
- The system prompt is passed via `--system-prompt` flag to define the agent's persona.
- The initial prompt contains the task instructions, issue context, and any relevant state from the database.

### Prompt Construction

When the backend resumes an agent or sends it new work, it constructs a prompt containing all relevant context from the database:

```
function buildPrompt(issue, agent, context):
    prompt = ""
    prompt += "## Your Role\n" + agent.system_prompt
    prompt += "## Issue\n" + issue.title + "\n" + issue.description
    prompt += "## Repository\n" + repo details and worktree path
    prompt += "## Previous Comments\n" + relevant comments from DB
    if context.feedbackComments:
        prompt += "## Review Feedback to Address\n" + feedback
    prompt += "## Instructions\n" + task-specific instructions
    return prompt
```

This approach means we never depend on Claude Code's session management. Every invocation gets a complete, self-contained prompt built from CrewDeck's database.

### Session Naming Convention

```
crewdeck-<issueId-short>-<agentId-short>-<role>
```

Examples:
- `crewdeck-a1b2c3-d4e5f6-worker`
- `crewdeck-a1b2c3-g7h8i9-reviewer`
- `crewdeck-orchestrator-<projectId-short>`

### Detecting Completion

The adapter monitors the tmux session to detect when Claude Code has finished processing:

1. **Process exit** — the Claude Code process exits (detected via `isAlive`).
2. **Idle detection** — no new output for a configurable timeout period, indicating the agent is waiting for input (meaning it finished its task and is awaiting the next instruction).

When completion is detected, the backend:
- Captures the final output.
- Stores relevant context in the Session table.
- Emits a `session.ended` WebSocket event.
- Triggers the orchestrator to handle the next step in the pipeline.

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
tmux pane → adapter.streamOutput() → backend WebSocket → frontend xterm.js
```

The adapter polls the tmux pane at a configurable interval (e.g., 100ms) and sends deltas to the backend, which broadcasts them via the `session.output` WebSocket event.

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
    worktreePath = repo.local_path + "/.worktrees/" + branchName

    run: git -C <repo.local_path> worktree add -b <branchName> <worktreePath> <baseBranch>

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
    run: git -C <repo.local_path> worktree remove <worktreePath>
    optionally: git -C <repo.local_path> branch -d <branchName>
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
    prompt += "\n## Crew\n" + list of agents with roles and expertise
    prompt += "\n## Instructions\n"
    prompt += "Decide what action to take based on the event and current state."
    prompt += "Respond with a structured action (assign, route_review, escalate, create_draft_issue, etc.)"
    return prompt
```

### Orchestrator Output Parsing

The backend parses the orchestrator's response to extract structured actions:

- **assign** — assign an agent to an issue.
- **route_review** — send an issue to the next reviewer.
- **escalate** — flag an issue for human attention.
- **create_draft_issue** — propose a new issue (enters Draft status).
- **reorder** — change issue priorities.
- **no_action** — nothing to do right now.

The backend executes these actions, updates the database, emits WebSocket events, and triggers further processing as needed.

## Future Adapters

To add support for a new CLI tool:

1. Implement the adapter interface (spawn, send, getOutput, streamOutput, isAlive, kill).
2. Handle tool-specific command construction (flags, prompt passing).
3. Handle tool-specific completion detection.
4. Register the adapter in the runtime configuration.

The rest of the system (backend, frontend, orchestrator, session management) requires no changes.
