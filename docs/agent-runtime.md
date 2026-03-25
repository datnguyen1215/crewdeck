---
title: CrewDeck Agent Runtime
version: 0.4.0
status: draft
---

# CrewDeck — Agent Runtime

## Overview

The Agent Runtime spawns AI agents as `claude -p` subprocesses. There are no tmux sessions or persistent interactive sessions. Each agent invocation is a one-shot process: it receives a prompt, runs to completion, and its stdout is captured and posted back as a comment on the issue.

## ProcessAdapter

`backend/src/orchestration/process.ts`

### spawnClaude

Spawns `claude -p` with the given prompt and system prompt.

```
spawnClaude(opts: SpawnOpts) → Promise<SpawnResult>
```

**SpawnOpts:**

| Field        | Type                   | Required | Description                                                                              |
| ------------ | ---------------------- | -------- | ---------------------------------------------------------------------------------------- |
| prompt       | string                 | Yes      | The task prompt (issue context + comments).                                              |
| systemPrompt | string                 | Yes      | The agent's system prompt. Written to a temp file and passed via `--system-prompt-file`. |
| workdir      | string                 | Yes      | Absolute path to the git worktree.                                                       |
| env          | Record<string, string> | No       | Additional environment variables.                                                        |

**SpawnResult:**

| Field       | Type                    | Description                      |
| ----------- | ----------------------- | -------------------------------- |
| pid         | number                  | Process ID.                      |
| process     | ChildProcess            | The spawned child process.       |
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

### spawnClaudeStream

Spawns `claude -p` with streaming JSON output for real-time token delivery. Used by the Captain Chat service and Monitor service.

```
spawnClaudeStream(opts: SpawnOpts) → Promise<StreamSpawnResult>
```

**StreamSpawnResult:**

| Field       | Type                             | Description                                  |
| ----------- | -------------------------------- | -------------------------------------------- |
| pid         | number                           | Process ID.                                  |
| process     | ChildProcess                     | The spawned child process.                   |
| events      | AsyncIterable<ClaudeStreamEvent> | Async iterator of parsed stream-json events. |
| exitPromise | Promise<{code, stdout}>          | Resolves when the process exits.             |

**Command constructed:**

```
claude -p <prompt via stdin> \
       --verbose \
       --system-prompt-file <tmpfile> \
       --output-format stream-json \
       --dangerously-skip-permissions
```

- `--output-format stream-json` causes Claude to emit newline-delimited JSON events as they occur (content deltas, tool calls, result).
- The prompt is written to stdin to avoid exceeding `ARG_MAX` for large prompts.

### spawnClaudeMultimodal

Spawns `claude -p` with multimodal (image) support. Used by the Captain Chat service when images are attached.

```
spawnClaudeMultimodal(opts: MultimodalOpts) → Promise<SpawnResult>
```

Uses `--output-format json` (non-streaming) and passes image data via stdin alongside the text prompt.

## Monitor Action Plans

`backend/src/orchestration/captain/action-schema.ts` + `plan-executor.ts`

The Monitor service uses structured action plans instead of curl calls for write operations. This enables parallel dispatch execution and faster mutex release.

### Flow

```
events arrive (issue.created, run.completed, etc.)
    │
    ├── Monitor service batches events
    │
    ├── spawnClaudeStream with system prompt
    │       └── LLM can use curl for READ operations (list issues, get issue, list knowledge)
    │
    ├── LLM outputs JSON action plan as final response
    │
    └── Backend executes plan via plan-executor.ts
            ├── Validate action plan with Zod schemas
            ├── Resolve truncated issue IDs to full UUIDs (see below)
            ├── Execute dispatch actions in parallel (Promise.all)
            └── Execute other actions sequentially
```

### Truncated Issue ID Resolution

The Monitor LLM sometimes outputs truncated 8-character issue ID prefixes (e.g. `3d97b21f`) instead of full UUIDs, because it sees short ID references in event data and comments (e.g. `#3d97b21f`). The plan executor resolves these before executing any action:

1. Try exact match via `getIssue(id)`.
2. If no match and the ID is shorter than 36 characters (full UUID length) but at least 8 characters, try a `LIKE prefix%` query scoped to the project via `getIssueByPrefix(prefix, projectId)`.
3. The prefix query returns a match only if exactly one issue matches (ambiguous prefixes return null).
4. If resolution fails, the action is rejected with an error result.

This resolution is applied to all action types that take an `issue_id` (dispatch, merge, comment, update-issue, skip).

### Action Types

| Type         | Fields                            | Description                           |
| ------------ | --------------------------------- | ------------------------------------- |
| dispatch     | issue_id, agent_id, instructions? | Dispatch agent to work on issue       |
| merge        | issue_id                          | Merge PR for issue                    |
| scan         | (none)                            | Trigger librarian codebase scan       |
| comment      | issue_id, content                 | Add comment to issue                  |
| create-issue | title, description?               | Create new issue                      |
| update-issue | issue_id, status?, title?         | Update issue status/title             |
| skip         | issue_id, reason                  | Skip issue (logged for observability) |

### Action Plan Format

```json
{
  "reasoning": "Brief explanation of decisions",
  "actions": [
    { "type": "dispatch", "issue_id": "abc", "agent_id": "engineer" },
    { "type": "dispatch", "issue_id": "def", "agent_id": "lead" },
    { "type": "merge", "issue_id": "ghi" }
  ]
}
```

The executor validates the plan using Zod schemas and executes dispatches in parallel. If multiple issues need work and slots are available, they all start simultaneously.

## MentionHandler

`backend/src/orchestration/handler.ts`

The MentionHandler subscribes to `comment.added` events and drives agent spawning.

### Flow

```
comment.added event
    │
    ├── parse /dispatch commands from comment.content
    │       (only /dispatch at start of line triggers spawns; @mentions are ignored)
    │
    ├── if multiple agents dispatched by an agent author:
    │       └── create batch (originator = comment.author_type, members = dispatched agents)
    │
    ├── for each dispatched agent:
    │       ├── skip if agent is the batch originator (will be auto-spawned later)
    │       ├── skip if agent already has an active process for this issue (deduplication)
    │       ├── check chain_depth < project.max_chain_depth (atomic DB increment)
    │       ├── check active process count < max_concurrency
    │       │       └── if limit reached: enqueue dispatch, post "Agent X queued (N ahead)"
    │       │               system comment, emit dispatch.queued — skip remaining steps
    │       ├── regress issue status to in_progress if needed (from any PR-related status or done)
    │       ├── create worktree if needed
    │       ├── build prompt from issue + comments + agentId
    │       └── spawnClaude(...)
    │
    └── on process exit:
            ├── post agent output as comment (author_type: agent ID, e.g., "engineer")
            ├── post system comment with cost/duration
            ├── emit mention.completed
            ├── drain dispatch queue: dequeue next for this project (if any),
            │       post "Agent X dequeued, spawning now" system comment,
            │       emit dispatch.dequeued, then spawn
            └── if agent is a batch member: mark completed in batch
```

### Batch Tracking

When a single comment dispatches multiple agents (e.g., `/dispatch engineer lead`), the handler groups them into a **batch**:

- The dispatched agents become **batch members** and are spawned immediately.
- Batches time out after **30 minutes**. A cleanup interval (every 5 minutes) fires `handleBatchComplete` on any stale batch, preventing orphaned state.
- Only one batch is tracked per issue at a time.
- Batches track completion of grouped dispatches so the originator isn't re-spawned while its batch members are still running.

### Chain Depth

Each spawn atomically increments `Issue.chain_depth`. If `chain_depth` is already at the project's `max_chain_depth` limit (default 20), the increment fails and a system comment is posted instead. Chain depth can be reset via `PATCH /api/v1/projects/:projectId/issues/:issueId` with `{ "chain_depth": 0 }`.

### Concurrency

Active processes are tracked in an in-memory map keyed by PID. Before spawning, the handler counts active processes for the project. If the count has reached `project.max_concurrency`, the dispatch is placed in an in-memory per-project FIFO queue instead of being dropped. A system comment is posted with the agent's queue position. When any active process exits, the handler dequeues the next pending dispatch for that project and spawns it. Queue state is in-memory and lost on restart.

### Timeouts

Each process is given a 10-minute timeout. On timeout, SIGTERM is sent; if the process does not exit within 5 seconds, SIGKILL is sent. A system comment is posted on the issue.

## MentionParser

`backend/src/orchestration/parser.ts`

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

### Rebase on Existing Branch

When a worktree branch already exists (subsequent agent runs on the same issue), the backend rebases it onto `origin/<defaultBranch>` after fetching. This ensures the agent always works on top of the latest main, even if other PRs have merged since the last run.

- Rebase only runs if the fetch succeeded (otherwise the local state is used as-is).
- If the rebase fails (e.g. merge conflicts), it is automatically aborted and a warning is logged. The agent continues with its existing branch state.

## Prompt Construction

`backend/src/orchestration/prompt.ts`

```
function buildPrompt(opts: BuildPromptOptions): string
  opts.issue            — issue title and description (XML-tagged)
  opts.comments         — all previous comments (XML-tagged, in order)
  opts.repo             — repo name and worktree path (optional)
  opts.worktreePath     — absolute path to the git worktree
  opts.agentId          — controls which API section is injected
  opts.projectKnowledge — project knowledge entries (filtered by agent assignment)
```

The function accepts a single options object containing all required and optional fields.

**Role-specific API access:** The prompt's API section varies by `agentId`. Librarian receives access to the knowledge internal API (list, create, update, delete knowledge entries). All other agents (engineer, lead, docs) receive a notice that their stdout is automatically posted as a comment — no direct API access needed.

**Project knowledge:** Knowledge entries are injected as a `## Project Knowledge` section. Each entry is rendered as a level-3 heading with its title and category, followed by the content:

```
## Project Knowledge

### Entry Title (category)
Entry content here...

### Another Entry (conventions)
More content...
```

Entries are filtered by agent assignment (`agent_ids` field) and ordered by `updated_at DESC, created_at DESC`. An agent only receives entries where `agent_ids` is null (applies to all agents) or contains the agent's ID.

Every invocation gets a complete, self-contained prompt from the database. The backend does not rely on Claude's session management.

## Startup and Shutdown

**Startup:** `recoverOnStartup()` queries the `AgentRun` table for any runs still in `running` status (orphaned by a previous crash or restart). It marks them as `failed`, posts a system comment on each affected issue, and emits `run.recovered` events.

**Shutdown:** `shutdownMentionHandler()` stops the batch cleanup interval, sends SIGTERM to all active processes, and clears the active-process and batch tracking maps.
