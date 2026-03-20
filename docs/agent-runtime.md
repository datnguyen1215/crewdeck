---
title: CrewDeck Agent Runtime
version: 0.4.0
status: draft
---

# CrewDeck — Agent Runtime

## Overview

The Agent Runtime spawns AI agents as `claude -p` subprocesses. There are no tmux sessions or persistent interactive sessions. Each agent invocation is a one-shot process: it receives a prompt, runs to completion, and its stdout is captured and posted back as a comment on the issue.

## ProcessAdapter

`backend/src/agent/adapters/process.ts`

### spawnClaude

Spawns `claude -p` with the given prompt and system prompt.

```
spawnClaude(opts: SpawnOpts) → Promise<SpawnResult>
```

**SpawnOpts:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| prompt | string | Yes | The task prompt (issue context + comments). |
| systemPrompt | string | Yes | The agent's system prompt. Written to a temp file and passed via `--system-prompt-file`. |
| workdir | string | Yes | Absolute path to the git worktree. |
| env | Record<string, string> | No | Additional environment variables. |

**SpawnResult:**

| Field | Type | Description |
|-------|------|-------------|
| pid | number | Process ID. |
| process | ChildProcess | The spawned child process. |
| exitPromise | Promise<{code, stdout}> | Resolves when the process exits. |

**Command constructed:**

```
claude -p <prompt> \
       --system-prompt-file <tmpfile> \
       --output-format json \
       --dangerously-skip-permissions
```

- `--output-format json` causes Claude to return a JSON object with a `result` field containing the response text, plus cost and duration metadata.
- The system prompt is written to a temp file and cleaned up after the process exits.
- `--dangerously-skip-permissions` allows the agent to operate autonomously.

## MentionHandler

`backend/src/mention/handler.ts`

The MentionHandler subscribes to `comment.added` events and drives agent spawning.

### Flow

```
comment.added event
    │
    ├── parse /dispatch commands from comment.content
    │       (only /dispatch at start of line triggers spawns; @mentions are ignored)
    │
    ├── if multiple agents dispatched by an agent author:
    │       └── create batch (originator = comment.author_id, members = dispatched agents)
    │
    ├── for each dispatched agent:
    │       ├── skip if agent is the batch originator (will be auto-spawned later)
    │       ├── skip if agent already has an active process for this issue (deduplication)
    │       ├── check chain_depth < 20 (atomic DB increment)
    │       ├── check active process count < max_concurrency
    │       ├── regress issue status to in_progress if needed
    │       ├── create worktree if needed
    │       ├── build prompt from issue + comments + agentId
    │       │       (captain also receives all open/in-progress issues)
    │       ├── if captain: inject GH_TOKEN from linked GitHub account
    │       └── spawnClaude(...)
    │
    └── on process exit:
            ├── post agent output as comment (author_type: "agent")
            ├── post system comment with cost/duration
            ├── emit mention.completed
            └── if agent is a batch member: mark completed in batch
                    └── if all batch members done: auto-spawn originator
```

### Batch Tracking

When a single comment dispatches multiple agents (e.g. Captain using `/dispatch engineer lead`), the handler groups them into a **batch**:

- The comment's author becomes the **originator**.
- The dispatched agents become **batch members** and are spawned immediately; the originator is skipped until the batch completes.
- When every batch member's process exits, the originator is auto-spawned so it can act on the combined results.
- Batches time out after **30 minutes**. A cleanup interval (every 5 minutes) fires `handleBatchComplete` on any stale batch, preventing orphaned state.
- Only one batch is tracked per issue at a time.

### Chain Depth

Each spawn atomically increments `Issue.chain_depth`. If `chain_depth` is already at the limit (20), the increment fails and a system comment is posted instead. Chain depth can be reset via `PATCH /api/v1/projects/:projectId/issues/:issueId` with `{ "chain_depth": 0 }`.

### Concurrency

Active processes are tracked in an in-memory map keyed by PID. Before spawning, the handler counts active processes for the project and rejects if `count >= project.max_concurrency`.

### Timeouts

Each process is given a 10-minute timeout. On timeout, SIGTERM is sent; if the process does not exit within 5 seconds, SIGKILL is sent. A system comment is posted on the issue.

## MentionParser

`backend/src/mention/parser.ts`

Parses `/dispatch` commands from comment text.

- `/dispatch agent1 agent2 ...` syntax (space-separated agents on one line).
- Only `/dispatch` at the start of a line triggers spawning.
- `@mentions` are ignored (cosmetic references only, do NOT trigger spawns).
- Case-insensitive matching, greedy (longest agent name first).
- Ignores dispatches inside fenced code blocks or inline backticks.
- Skips self-dispatches (agent cannot dispatch itself).

## Git Worktree Management

When an agent starts work on an issue that has no worktree, the backend creates one:

```
branchName = "crewdeck/" + issue.id-short + "-" + slugify(issue.title)
worktreePath = tmpdir() + "/crewdeck-worktrees/" + branchName
git -C <repoPath> fetch origin                          # updates origin/<defaultBranch>
git -C <repoPath> worktree add -b <branchName> <worktreePath> origin/<defaultBranch>
```

If the fetch fails (e.g. network error), the worktree is created from the local branch instead and a warning is logged.

The worktree path and branch name are recorded on the issue and reused for subsequent agent invocations.

## Prompt Construction

`backend/src/agent/prompt.ts`

```
function buildPrompt(opts: BuildPromptOptions): string
  opts.issue          — issue title and description (XML-tagged)
  opts.comments       — all previous comments (XML-tagged, in order)
  opts.repo           — repo name and worktree path (optional)
  opts.worktreePath   — absolute path to the git worktree
  opts.agentId        — controls which API section is injected
  opts.projectIssues  — all open/in-progress issues (captain only)
```

A backward-compatible 4-argument form (`issue, comments, repo, worktreePath`) is also accepted for callers that do not need the new fields.

**Role-specific API access:** The prompt's API section varies by `agentId`. Captain receives the full API reference (issues CRUD, status transitions, activity log, internal comment/issue endpoints). All other agents receive a notice that their stdout is automatically posted as a comment — no direct API access.

**Captain project issues:** When `agentId` is `"captain"`, the prompt includes a summary of all open and in-progress issues (excluding the current one) to support dependency-aware scheduling.

Every invocation gets a complete, self-contained prompt from the database. The backend does not rely on Claude's session management.

## Startup and Shutdown

**Startup:** `recoverOnStartup()` logs that any in-flight processes from before the crash are lost. In-memory state cannot be recovered.

**Shutdown:** `shutdownMentionHandler()` stops the batch cleanup interval, sends SIGTERM to all active processes, and clears the active-process and batch tracking maps.
