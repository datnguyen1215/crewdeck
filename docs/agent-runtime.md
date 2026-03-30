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

Spawns `claude -p` with the given prompt and system prompt. Provider-specific environment variables are injected automatically based on the global provider setting.

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
| model        | string                 | No       | Claude model to use (`sonnet` or `opus`). Passed as `--model <model>` to the CLI.        |

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
       --model <model> \
       --dangerously-skip-permissions \
       --settings '{"attribution":{"commit":"","pr":""}}'
```

- `--output-format json` causes Claude to return a JSON object with a `result` field containing the response text, plus cost and duration metadata.
- The system prompt is written to a temp file and cleaned up after the process exits.
- `--dangerously-skip-permissions` allows the agent to operate autonomously.
- `--model <model>` is included when a model is specified (resolved via AgentConfig override → project default → `"sonnet"`).
- `--settings '{"attribution":{"commit":"","pr":""}}'` disables AI attribution in commits and PRs (no Co-Authored-By trailers or signatures).

**Provider environment variables:**

The global provider setting (configurable via Crew page) determines which environment variables are injected:

- **Claude (default)**: Uses `ANTHROPIC_API_KEY` from environment (no additional variables).
- **GLM (Z.AI)**: Injects `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and `ANTHROPIC_AUTH_TOKEN=$ZAI_API_KEY`. Requires `ZAI_API_KEY` environment variable to be set on the backend.

Provider variables are injected via `buildProviderEnv()` in `backend/src/orchestration/provider-env.ts` and apply to all `claude -p` spawns (including Captain terminal sessions).

### spawnClaudeStream

Spawns `claude -p` with streaming JSON output for real-time token delivery. Used for real-time event streaming from agent runs.

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
       --model <model> \
       --dangerously-skip-permissions \
       --settings '{"attribution":{"commit":"","pr":""}}'
```

- `--output-format stream-json` causes Claude to emit newline-delimited JSON events as they occur (content deltas, tool calls, result).
- The prompt is written to stdin to avoid exceeding `ARG_MAX` for large prompts.
- `--settings '{"attribution":{"commit":"","pr":""}}'` disables AI attribution in commits and PRs.

## Captain Command Execution

`backend/src/orchestration/command-handlers.ts`

Captain outputs commands in comments which are parsed and executed by the backend. Commands include `/dispatch`, `/merge`, `/create-pr`, and `/create-issue`.

### Flow

```
captain reads issue comments and project state
    │
    ├── captain outputs commands in comment
    │
    ├── comment.added event fires
    │
    ├── handler.ts parses commands (captain-only)
    │
    └── command-handlers.ts executes each command
            ├── /dispatch → spawnAgent()
            ├── /merge → handleMergePR()
            ├── /create-pr → handleCreatePR()
            └── /create-issue → handleCreateIssue()
```

### Truncated Issue ID Resolution

Captain sometimes outputs truncated 8-character issue ID prefixes (e.g. `3d97b21f`) instead of full UUIDs in commands. The command handlers resolve these before executing:

1. Try exact match via `getIssue(id)`.
2. If no match and the ID is shorter than 36 characters (full UUID length) but at least 8 characters, try a `LIKE prefix%` query scoped to the project via `getIssueByPrefix(prefix, projectId)`.
3. The prefix query returns a match only if exactly one issue matches (ambiguous prefixes return null).
4. If resolution fails, the command is rejected with an error result.

This resolution is applied to all commands that take an `issue_id` (dispatch, merge, create-pr).

### Commands

| Command       | Format                | Description                     |
| ------------- | --------------------- | ------------------------------- |
| /dispatch     | `/dispatch agent_id`  | Dispatch agent to work on issue |
| /merge        | `/merge issue_id`     | Merge PR for issue              |
| /create-pr    | `/create-pr issue_id` | Create GitHub PR for issue      |
| /create-issue | `/create-issue title` | Create new issue                |

Commands are parsed from captain's comment output and executed sequentially. Only captain can execute these orchestration commands (restricted by `author_type` check).

**Manual Approval Workflow:**

When `auto_start` or `auto_merge` settings are disabled, users can manually approve specific issues:

- **Play button** → `POST /issues/:id/approve-start` → `issue.approved_to_start` event → Captain dispatches engineer
- **Merge button** → `POST /issues/:id/approve-merge` → `issue.approved_to_merge` event → Captain merges PR

The approval flags are checked in `handleDispatchAgent()` and `handleMergePR()`:
- `canStart = approvedToStart.has(issueId) || project.auto_start`
- `canMerge = approvedToMerge.has(issueId) || project.auto_merge`

Flags are cleared after successful dispatch/merge and stored in-memory (reset on server restart).

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
    │       ├── guard against merged PRs: if issue status is 'done', check issue_prs table
    │       │       └── if merged PR found: rollback chain_depth, post "Dispatch rejected: issue
    │       │               already has a merged PR (#NNN)" system comment, return early
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

Active processes are tracked in an in-memory map keyed by PID. Before spawning, the handler checks two concurrency limits:

1. **Global limit** — `MAX_AGENTS` env var (default 10). Counts all running agents across all projects via `AgentRun.status='running'`.
2. **Per-project limit** — `project.max_concurrency`. Counts running agents for the specific project.

If either limit is reached, the dispatch is placed in a DB-backed FIFO queue (using `AgentRun` table with `status='queued'`) instead of being dropped. A system comment is posted with the agent's queue position. When any active process exits, the handler dequeues the next pending dispatch for that project and spawns it. Queue state persists across server restarts — on startup, queued runs are restored from the database.

### Timeouts

Each spawned agent process is given a 10-minute timeout. On timeout, SIGTERM is sent; if the process does not exit within 5 seconds, SIGKILL is sent. A system comment is posted on the issue.

The captain monitor's `processWithLLM()` function (in `monitor-agent.ts`) applies separate timeouts to its internal `claude -p` calls:

- **Main LLM call** — 2-minute timeout. On timeout, SIGTERM is sent to the `claude -p` process; if it does not exit within 5 seconds, SIGKILL is sent. This prevents a hung process from holding the queue mutex and blocking all subsequent event processing.
- **Retry extraction call** — 30-second timeout (same SIGTERM/SIGKILL pattern). This covers the simpler JSON extraction prompt used on retry.

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

### Worktree Types

CrewDeck uses two types of git worktrees:

1. **Issue worktrees** — ephemeral worktrees created per issue (named `crewdeck/issue-<issueId>-<title-slug>`). Cleaned up when the issue reaches `done` status or is deleted.
2. **Captain worktrees** — long-lived worktrees for the Captain Chat terminal (named `crewdeck/captain-{projectId}`). Persist across PTY session reconnects and are reused. Created in `/tmp/crewdeck-worktrees/` and auto-rebase onto the latest default branch on creation.

### Worktree Cleanup

Issue worktrees are automatically cleaned up when an issue reaches `done` status or when an issue is deleted. The cleanup is handled by an event listener (`initWorktreeCleanup()`) initialized at startup. Captain worktrees are long-lived and persist across terminal sessions.

**Event-driven cleanup (`initWorktreeCleanup()`):**

1. Listens for `issue.status_changed` events with `to === "done"`
2. Retrieves the issue and checks for worktree info (`worktree_path`, `branch_name`, `repo_id`)
3. If the worktree path is already missing from disk, clears DB fields and returns early
4. If the worktree path exists, calls `cleanupWorktree(repo, worktreePath, branchName, true)` to remove it
5. **Always clears** `worktree_path` and `branch_name` fields on the issue record (via `finally` block) regardless of cleanup success
6. Logs warnings on failure but continues — cleanup errors are non-fatal

**Synchronous cleanup on deletion:**

When an issue is deleted via `DELETE /issues/:issueId`, cleanup runs synchronously before database deletion:

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
    run: git -C <repoPath> worktree remove <worktreePath>
    if deleteBranch:
        git -C <repoPath> branch -d <branchName>
```

## Prompt Construction

`backend/src/orchestration/prompt.ts`

```
function buildPrompt(opts: BuildPromptOptions): string
  opts.issue            — issue title and description (XML-tagged)
  opts.comments         — all previous comments (XML-tagged, in order)
  opts.repo             — repo name and worktree path (optional)
  opts.worktreePath     — absolute path to the git worktree
  opts.agentId          — controls which API section is injected
  opts.projectKnowledge — project knowledge entries (all entries for the project)
```

The function accepts a single options object containing all required and optional fields.

**Role-specific API access:** The prompt's API section varies by `agentId`. All agents receive read-only access to the knowledge API (list titles, get full entries). Only the librarian receives write access (create, update, delete knowledge entries). All non-librarian agents receive a notice that their stdout is automatically posted as a comment.

**Project knowledge:** Knowledge entries are injected as a `## Project Knowledge` section. Each entry is rendered as a level-3 heading with its title and category, followed by the content:

```
## Project Knowledge

### Entry Title (category)
Entry content here...

### Another Entry (conventions)
More content...
```

Entries are filtered by category. Only `workflows` and `conventions` categories are injected into agent prompts. Entries with `architecture`, `setup`, and `api` categories are available via read-only knowledge API endpoints that agents can query on demand. All entries are ordered by `updated_at DESC, created_at DESC`.

Every invocation gets a complete, self-contained prompt from the database. The backend does not rely on Claude's session management.

## Startup and Shutdown

**Startup:** `recoverOnStartup()` queries the `AgentRun` table for any runs still in `running` status (orphaned by a previous crash or restart). It marks them as `failed` and posts a system comment on each affected issue. `recoverQueue()` is then called to restore queued runs — it counts and logs the number of queued runs awaiting execution.

**Spawn failure handling:** If `spawnClaudeStream()` throws during `spawnAndTrack()` (e.g., process cannot be created), the `AgentRun` record is immediately marked `failed` with a `completed_at` timestamp, `onComplete()` is called for cleanup (e.g., SSH key removal), and the error is re-thrown. This prevents runs from being permanently stuck in `running` with a null PID, which would block further work on the issue.

**Shutdown:** `shutdownMentionHandler()` stops the batch cleanup interval, sends SIGTERM to all active processes, and clears the active-process and batch tracking maps.
