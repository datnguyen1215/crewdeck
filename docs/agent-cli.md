---
title: CrewDeck Agent CLI
version: 0.1.0
status: draft
---

# CrewDeck — Agent CLI

## Overview

The CrewDeck CLI is a lightweight command-line tool that AI agents use to communicate back to the CrewDeck backend from within their tmux sessions. Agents cannot directly access the backend's in-process event bus, so the CLI bridges that gap by making HTTP calls to internal backend API endpoints.

The CLI lives in the `cli/` directory of the CrewDeck repository.

## Why a CLI?

AI agents run as separate processes inside tmux sessions. They have no access to the Node.js backend's event bus or internal state. The CLI gives agents a structured way to:

- Signal task completion
- Post comments on issues
- Report progress and status updates
- Flag problems or request escalation

Without the CLI, the backend would have to rely solely on polling tmux output or watching for process exit — both are less reliable and less expressive than explicit agent-initiated communication.

## Installation and Environment

The CLI is available in every agent's tmux session. The backend sets the following environment variables when spawning a session:

| Variable | Description |
|----------|-------------|
| `CREWDECK_API_URL` | Backend API base URL (e.g., `http://localhost:3000/api/v1`) |
| `CREWDECK_SESSION_ID` | The agent's session ID in the CrewDeck database |
| `CREWDECK_ISSUE_ID` | The issue ID the agent is working on |
| `CREWDECK_AGENT_ID` | The agent's ID |
| `CREWDECK_PROJECT_ID` | The project ID |

These environment variables are automatically set by the Agent Runtime when spawning the tmux session, so the agent does not need to provide them manually.

## Commands

### signal

Emit a signal event to the backend. Used primarily to indicate task completion.

```
crewdeck signal --event <event-name> [--data <json>]
```

**Arguments:**

| Flag | Required | Description |
|------|----------|-------------|
| `--event` | Yes | Event name. One of: `work-complete`, `review-complete`, `error`, `needs-help` |
| `--data` | No | JSON string with additional event data |

**Examples:**

```bash
# Signal that work is complete
crewdeck signal --event work-complete

# Signal that a review is complete with a verdict
crewdeck signal --event review-complete --data '{"verdict": "approved"}'
crewdeck signal --event review-complete --data '{"verdict": "changes_requested"}'

# Signal an error
crewdeck signal --event error --data '{"message": "Cannot access repository, permission denied"}'

# Request human help
crewdeck signal --event needs-help --data '{"message": "Unclear requirements, need clarification on auth flow"}'
```

**Backend behavior:** The backend receives the signal via its internal API, validates it, and emits the corresponding event on the event bus. This triggers the Orchestrator Manager, WebSocket broadcaster, and Activity Logger.

### comment

Post a comment on the current issue.

```
crewdeck comment --message <text>
```

**Arguments:**

| Flag | Required | Description |
|------|----------|-------------|
| `--message` | Yes | Comment content (Markdown supported) |

**Examples:**

```bash
# Report progress
crewdeck comment --message "Investigating the auth middleware. Found the root cause: session validation throws on expired tokens instead of returning null."

# Report what was done
crewdeck comment --message "Fixed the session validator and added test coverage for expired token handling. Modified files: src/auth/middleware.ts, tests/auth.test.ts"

# Post review feedback
crewdeck comment --message "Code looks good overall. One suggestion: consider adding a specific error code for expired vs invalid tokens."
```

**Backend behavior:** Creates a Comment record in the database with `author_type: "agent"` and the agent's ID. Emits `comment.added` on the event bus.

### status

Update the agent's status on the current issue.

```
crewdeck status --state <state>
```

**Arguments:**

| Flag | Required | Description |
|------|----------|-------------|
| `--state` | Yes | The agent's state. One of: `active`, `done`, `error` |

**Examples:**

```bash
# Indicate the agent is actively working
crewdeck status --state active

# Indicate the agent is done with its current task
crewdeck status --state done

# Indicate an error occurred
crewdeck status --state error
```

**Backend behavior:** Updates the IssueAgent record's status field. Emits `agent.status_changed` on the event bus.

### files

Report which files were modified during the session. Used for context storage.

```
crewdeck files --modified <file1> [<file2> ...]
```

**Examples:**

```bash
crewdeck files --modified src/auth/middleware.ts src/auth/session.ts tests/auth.test.ts
```

**Backend behavior:** Updates the Session.context JSON with the list of modified files. This information is used when constructing prompts for reviewers or follow-up sessions.

## Internal API Endpoints

The CLI communicates with the backend via these internal endpoints. These are not part of the public REST API and are not intended for frontend use.

```
POST /api/v1/internal/signal
POST /api/v1/internal/comment
POST /api/v1/internal/status
POST /api/v1/internal/files
```

All requests include the session context from environment variables:

```json
{
  "session_id": "$CREWDECK_SESSION_ID",
  "agent_id": "$CREWDECK_AGENT_ID",
  "issue_id": "$CREWDECK_ISSUE_ID",
  "project_id": "$CREWDECK_PROJECT_ID",
  ...command-specific fields
}
```

## Agent System Prompt Integration

The agent's system prompt should include instructions to use the CrewDeck CLI. The backend injects this into every agent prompt:

```
## CrewDeck CLI

You have access to the `crewdeck` CLI tool for communicating with the CrewDeck system.

Available commands:
- `crewdeck signal --event work-complete` — call this when you have finished your task
- `crewdeck signal --event review-complete --data '{"verdict": "approved"}'` — call this when you finish a review
- `crewdeck signal --event error --data '{"message": "..."}'` — call this if you encounter an unrecoverable error
- `crewdeck signal --event needs-help --data '{"message": "..."}'` — call this if you need human assistance
- `crewdeck comment --message "..."` — post a comment on the issue to report progress or findings
- `crewdeck files --modified <files...>` — report which files you modified

IMPORTANT: Always call `crewdeck signal --event work-complete` when you are done with your task.
```

Additionally, a reference to the full CLI documentation should be placed in the project's CLAUDE.md so that Claude Code can access it:

```
See docs/agent-cli.md for the full CrewDeck CLI reference.
```

## Event Flow Example

```
Agent finishes work in tmux
    │
    ├── crewdeck comment --message "Fixed the bug, added tests"
    │       → POST /api/v1/internal/comment
    │       → Event bus: comment.added
    │       → WebSocket: comment.added (to frontend)
    │       → Activity Logger: writes log entry
    │
    ├── crewdeck files --modified src/auth/middleware.ts tests/auth.test.ts
    │       → POST /api/v1/internal/files
    │       → Session.context updated in DB
    │
    └── crewdeck signal --event work-complete
            → POST /api/v1/internal/signal
            → Event bus: agent.finished
            → Orchestrator Manager: routes to review
            → WebSocket: agent.finished
            → Activity Logger: writes log entries
```
