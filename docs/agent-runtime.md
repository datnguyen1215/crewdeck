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
    ├── parse @mentions from comment.content
    │
    ├── for each mentioned agent:
    │       ├── check chain_depth < 20 (atomic DB increment)
    │       ├── check active process count < max_concurrency
    │       ├── regress issue status to in_progress if needed
    │       ├── create worktree if needed
    │       ├── build prompt from issue + comments
    │       └── spawnClaude(...)
    │
    └── on process exit:
            ├── post agent output as comment (author_type: "agent")
            ├── post system comment with cost/duration
            └── emit mention.completed
```

### Chain Depth

Each spawn atomically increments `Issue.chain_depth`. If `chain_depth` is already at the limit (20), the increment fails and a system comment is posted instead. Chain depth can be reset via the API (`POST /api/v1/projects/:projectId/issues/:issueId/reset-chain-depth`).

### Concurrency

Active processes are tracked in an in-memory map keyed by PID. Before spawning, the handler counts active processes for the project and rejects if `count >= project.max_concurrency`.

### Timeouts

Each process is given a 10-minute timeout. On timeout, SIGTERM is sent; if the process does not exit within 5 seconds, SIGKILL is sent. A system comment is posted on the issue.

## MentionParser

`backend/src/mention/parser.ts`

Parses `@mentions` from comment text.

- Case-insensitive, greedy matching (longest agent name first).
- One match per line.
- Ignores mentions inside fenced code blocks or inline backticks.
- Skips self-mentions (agent cannot mention itself).

## Git Worktree Management

When an agent starts work on an issue that has no worktree, the backend creates one:

```
branchName = "crewdeck/" + issue.id-short + "-" + slugify(issue.title)
worktreePath = tmpdir() + "/crewdeck-worktrees/" + branchName
git -C <repoPath> worktree add -b <branchName> <worktreePath> <defaultBranch>
```

The worktree path and branch name are recorded on the issue and reused for subsequent agent invocations.

## Prompt Construction

`backend/src/agent/prompt.ts`

```
function buildPrompt(issue, comments, repo, worktreePath):
    parts = []
    parts += issue title and description (XML-tagged)
    if repo:
        parts += repo name and worktree path
    if comments:
        parts += all previous comments (XML-tagged, in order)
    return join(parts, "\n\n")
```

Every invocation gets a complete, self-contained prompt from the database. The backend does not rely on Claude's session management.

## Startup and Shutdown

**Startup:** `recoverOnStartup()` logs that any in-flight processes from before the crash are lost. In-memory state cannot be recovered.

**Shutdown:** `shutdownMentionHandler()` sends SIGTERM to all active processes and clears the tracking map.
