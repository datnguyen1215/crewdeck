---
title: CrewDeck Agent Orchestration
version: 0.3.0
status: draft
---

# CrewDeck — Agent Orchestration

## Overview

Agents are triggered by **@mentions** in issue comments. When a user or another agent posts a comment containing `@agent-name`, the backend automatically spawns that agent as a `claude -p` subprocess. The agent's output is posted back to the issue as a comment.

There is no persistent captain session or CLI tool for agents to call. All orchestration happens through the comment thread.

## How It Works

1. A user (or agent) posts a comment on an issue containing `@agent-name`.
2. The `MentionHandler` detects the mention via the `comment.added` event.
3. The backend spawns `claude -p` with the agent's system prompt and a prompt built from the issue + comment history.
4. The agent runs to completion and its output is posted back as a comment attributed to the agent.
5. If the agent's output mentions another agent, that agent is spawned in turn (up to the chain depth limit).

When a single comment mentions **multiple agents**, they are grouped as a batch. The mentioned agents (batch members) are spawned immediately, and the comment's author (the originator) is automatically re-spawned once all batch members have completed. This lets Captain, for example, delegate work to several specialists and be invoked again when all results are ready.

## @Mention Rules

- One mention per line is processed.
- Matching is case-insensitive and greedy (longest agent name matched first).
- Mentions inside fenced code blocks or inline backticks are ignored.
- Agents cannot mention themselves (self-mentions are skipped).
- When multiple agents are mentioned in one comment, the comment's author is skipped in the initial spawn and is auto-spawned after all batch members finish.

## Limits

| Limit | Value | Behavior when exceeded |
|-------|-------|----------------------|
| Chain depth | 20 | System comment posted; "Reset chain depth" button appears on the issue |
| Max concurrency | Project setting | System comment posted; mention is dropped |
| Process timeout | 10 minutes | Process killed; system comment posted |
| Batch timeout | 30 minutes | Stale batch is force-completed and originator is auto-spawned |

Chain depth is tracked per-issue and increments each time an agent is spawned on that issue. It can be reset via the "Reset chain depth" button on the issue detail page.

## Issue Status

Mentioning an agent on an issue automatically regresses its status to `in_progress` if it was `open`, `pr_created`, or `done`. Status transitions are:

| Trigger | Status change |
|---------|--------------|
| Agent spawned on open/done/pr_created issue | → `in_progress` |
| User clicks "Mark as PR Created", or Captain runs `gh pr create` | → `pr_created` |
| User clicks "Mark as Done" (no active processes) | → `done` |

## Environment Variables

The following variables are passed to each agent process:

| Variable | Description |
|----------|-------------|
| `CREWDECK_API_URL` | Backend API base URL |
| `CREWDECK_PROJECT_ID` | The project ID |
| `CREWDECK_AGENT_ID` | The agent's ID |
| `CREWDECK_ISSUE_ID` | The issue ID being worked on |
| `GH_TOKEN` | GitHub OAuth token — injected for Captain only, from the project's linked GitHub account |

In addition, any project-level environment variables configured via the [Environment Variables API](api.md#environment-variables) are injected.

## Prompt Construction

Each agent receives a prompt built from:

- The issue title and description
- The repository name and worktree path
- All previous comments on the issue (in order)
- For Captain only: a summary of all other open/in-progress issues (for dependency-aware scheduling)

The agent's system prompt is passed via `--system-prompt-file`. The backend does not rely on Claude's session management — every invocation gets a complete, self-contained prompt built from CrewDeck's database.

## Worktree

If the issue does not yet have a worktree, one is created from the project's default branch before spawning the agent. Worktree path and branch name are recorded on the issue.

See [Agent Runtime](agent-runtime.md) for implementation details.
