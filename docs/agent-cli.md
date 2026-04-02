---
title: CrewDeck Agent Orchestration
version: 0.3.0
status: draft
---

# CrewDeck — Agent Orchestration

## Overview

Agents are triggered by **`/dispatch` commands** in issue comments. When a user or another agent posts a comment containing `/dispatch agent-name` at the start of a line, the backend automatically spawns that agent as a `claude -p` subprocess. The agent's output is posted back to the issue as a comment.

`@mentions` are cosmetic references only — they do NOT trigger agent spawns. All orchestration happens through `/dispatch` commands in issue comments.

## How It Works

1. A user (or agent) posts a comment on an issue containing `/dispatch agent-name`.
2. The `MentionHandler` detects the `/dispatch` command via the `comment.added` event.
3. The backend spawns `claude -p` with the agent's system prompt and a prompt built from the issue + comment history.
4. The agent runs to completion and its output is posted back as a comment attributed to the agent.
5. If the agent's output includes a `/dispatch` command, that agent is spawned in turn (up to the chain depth limit).

## /dispatch Rules

- `/dispatch` must appear at the start of a line (leading whitespace is allowed).
- Multiple agents can be dispatched on one line: `/dispatch engineer lead`.
- Matching is case-insensitive.
- Dispatches inside fenced code blocks or inline backticks are ignored.
- Agents cannot dispatch themselves (self-dispatches are skipped).
- Background services (e.g., Captain) cannot be dispatched — they have `dispatchable: false` and are ignored by the parser.

## Limits

| Limit           | Value                        | Behavior when exceeded                                                 |
| --------------- | ---------------------------- | ---------------------------------------------------------------------- |
| Chain depth     | Project setting (default 20) | System comment posted; "Reset chain depth" button appears on the issue |
| Max concurrency | Project setting              | System comment posted; dispatch is dropped                             |
| Process timeout | 10 minutes                   | Process killed; system comment posted                                  |

Chain depth is tracked per-issue and increments each time an agent is spawned on that issue. The limit is configurable via `max_chain_depth` in project settings. It can be reset via the "Reset chain depth" button on the issue detail page.

## Issue Status

Dispatching an agent on an issue automatically regresses its status to `in_progress` if it was `open`, any PR-related status (`pr_created`, `pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`), or `done`. Status transitions are:

| Trigger                                                                   | Status change   |
| ------------------------------------------------------------------------- | --------------- |
| Agent spawned on open/done/PR-related issue                               | → `in_progress` |
| User clicks "Mark as PR Created", or a PR is auto-detected from a comment | → `pr_created`  |
| User clicks "Mark as Done" (no active processes)                          | → `done`        |

## Environment Variables

The following variables are passed to each agent process:

| Variable              | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `CREWDECK_API_URL`    | Backend API base URL                                       |
| `CREWDECK_PROJECT_ID` | The project ID                                             |
| `CREWDECK_AGENT_ID`   | The agent's ID                                             |
| `CREWDECK_ISSUE_ID`   | The issue ID being worked on                               |
| `CREWDECK_API_KEY`    | System API key for authentication (passed as Bearer token) |

In addition, any project-level environment variables configured via the [Environment Variables API](api.md#environment-variables) are injected.

## Prompt Construction

Each agent receives a prompt built from:

- The issue title and description
- Project knowledge entries (conventions, structure notes, gotchas) — filtered by agent assignment
- The repository name and worktree path
- All previous comments on the issue (in order)

The agent's system prompt is passed via `--system-prompt-file`. The backend does not rely on Claude's session management — every invocation gets a complete, self-contained prompt built from CrewDeck's database.

## Worktree

If the issue does not yet have a worktree, one is created from the project's default branch before spawning the agent. Worktree path and branch name are recorded on the issue.

See [Agent Runtime](agent-runtime.md) for implementation details.
