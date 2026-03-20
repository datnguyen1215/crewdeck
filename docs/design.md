---
title: CrewDeck Design Document
version: 0.3.0
status: draft
---

# CrewDeck — Design Document

## Problem Statement

Software development teams increasingly want to leverage AI coding agents for autonomous task execution. However, managing multiple AI agents working simultaneously on a codebase presents several challenges:

- **No unified coordination** — agents operate in isolation with no awareness of each other's work.
- **No review pipeline** — AI-generated code goes unreviewed or requires manual human review for every change.
- **No audit trail** — there is no record of why an agent made specific decisions or what feedback it received.
- **Vendor lock-in** — systems built around a specific AI tool cannot easily adopt alternatives.

CrewDeck solves these problems by providing a local-first issue management platform where AI agents autonomously work on issues, collaborate through comment threads, and prepare pull requests — all under human oversight.

## Core Concepts

### Project

A project represents a body of work tied to one or more GitHub repositories. Each project has:

- A name and description.
- A memory field for project context (conventions, structure notes, gotchas) injected into agent prompts.
- One or more linked GitHub repositories.
- A shared roster of 4 fixed agents (defined globally, not per-project).
- A concurrency limit (max simultaneous agent processes).

### Agent

The crew is a fixed set of 4 immutable agents defined in code (Captain, Engineer, Lead, Docs). Each has a name, title, description, and system prompt. They are not stored in the database and cannot be created, modified, or deleted.

Agent names are used for `/dispatch` command matching.

### Orchestration via /dispatch Commands

Orchestration is driven by `/dispatch` commands in issue comments. When a user or agent posts a comment containing `/dispatch agent-name` at the start of a line, the backend spawns that agent as a `claude -p` subprocess. The agent runs to completion and posts its output back as a comment. If the agent's output includes a `/dispatch` command, that agent is spawned in turn.

`@mentions` are cosmetic references only — they do NOT trigger agent spawns. This prevents duplicate spawns when agents reference each other in summaries or feedback.

A single `/dispatch` line can list multiple agents (space-separated), e.g., `/dispatch engineer lead`. When multiple agents are dispatched, they are grouped as a batch. The batch members are spawned immediately, and the comment's author (the originator) is automatically re-spawned once all batch members have completed. This allows Captain, for example, to delegate work to several specialists and be invoked again when all results are ready.

The chain depth is tracked per issue (max 20) to prevent infinite loops. Concurrency is bounded by the project's `max_concurrency` setting.

### Issue

An issue is the fundamental unit of work. Issues have:

- A title and description.
- A status reflecting its position in the lifecycle.
- A comment thread where agents and humans post updates, findings, and review feedback.
- Linked branch/worktree information (recorded when an agent first begins work).
- Linked pull requests (created via the "Mark as PR Created" action).
- An activity log recording every state change and action.
- A chain depth counter tracking how many agent spawns have occurred.

### Comment

Comments are the communication and orchestration layer. Agents post comments with:

- Implementation progress and decisions.
- Review feedback.
- `/dispatch` commands to trigger follow-up work from other agents.

System comments are posted automatically for lifecycle events (agent started, finished, chain depth reached, etc.).

Humans can post comments to provide direction, ask questions, or trigger agents.

### Pull Request

Pull requests are tracked in the `IssuePR` table. They can be linked to an issue in two ways:

- **Manual**: the user clicks "Mark as PR Created", which transitions the issue to `pr_created` and records the PR.
- **Auto-link**: when a comment is posted containing a GitHub PR URL (e.g. `https://github.com/owner/repo/pull/123`), the PR detector automatically creates an `IssuePR` record linking it to the issue (deduped by repo + PR number).

## Issue Lifecycle

```
Open → In Progress → PR Created → Done
```

### States

| State | Description |
|-------|-------------|
| **Open** | Issue is in the queue, ready to be worked on. |
| **In Progress** | An agent is actively working (or has worked) on the issue. Set automatically when an agent is spawned. |
| **PR Created** | A pull request has been created. Set via the "Mark as PR Created" button, automatically by the Captain agent after creating a PR with `gh pr create`, or auto-detected when a PR URL is posted in a comment. |
| **Done** | Issue resolved. Set via the "Mark as Done" button (blocked if active processes are running), or automatically when a linked PR is merged. |

Dispatching an agent on a `pr_created` or `done` issue automatically regresses it to `in_progress`.

## Technology Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Backend language** | TypeScript | Type safety, shared types with frontend |
| **HTTP framework** | Express | Widely adopted, mature ecosystem |
| **Database** | SQLite via `better-sqlite3` | Synchronous API (performance advantage for SQLite), no async overhead, raw SQL for full control |
| **Request validation** | Zod | Strict schema validation, self-documenting, TypeScript integration |
| **WebSocket** | `ws` | Minimal, no abstraction overhead |
| **Testing** | Vitest + supertest | Vitest for unit tests; supertest for HTTP integration tests |
| **Logging** | pino | Fast structured JSON logging |
| **Frontend framework** | SvelteKit (Svelte 5 with runes) | Fine-grained reactivity, minimal boilerplate |
| **CSS** | Tailwind CSS | Utility-first, dark theme, no component library |
| **Configuration** | Environment variables (`.env`) | Simple, standard approach |
| **Agent spawning** | `claude -p` (print mode) | One-shot process per mention; no persistent sessions to manage |

## Project Structure

```
crewdeck/
├── frontend/          # SvelteKit application
├── backend/           # Express + TypeScript API server
├── docker-compose.yml # Docker Compose for containerized deployment
└── docs/              # Design documentation
```

The frontend and backend are separate directories. Each has its own `package.json` and runs independently.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Frontend (Svelte)               │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Project  │ │  Issue   │ │  Comment Thread  │ │
│  │Dashboard │ │  Board   │ │  (@mention UI)   │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │   Crew   │ │ Activity │ │  Notifications   │ │
│  │  (view)  │ │   Log    │ │                  │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │ WebSocket + REST
                     ▼
┌─────────────────────────────────────────────────┐
│            Backend (Node.js + TypeScript)         │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │   REST   │ │WebSocket │ │   Event Bus      │ │
│  │ API (v1) │ │ Server   │ │  (EventEmitter)  │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │  MentionHandler + ProcessAdapter            │ │
│  │  (comment.added → claude -p → comment)      │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │  Centralized Error Handler + Zod Validation  │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
     ┌────────┐ ┌────────┐ ┌────────┐
     │ SQLite │ │   gh   │ │ claude │
     │   DB   │ │  CLI   │ │  -p    │
     └────────┘ └────────┘ └────────┘
```

### Component Responsibilities

**Frontend (Svelte)**
- Renders project dashboard, issue board, crew (read-only), activity log.
- Connects to backend via WebSocket for real-time updates (comments, status changes, agent activity).
- Provides autocomplete for `/dispatch` commands and `@mentions` in comment input.
- Provides "Mark as PR Created" and "Mark as Done" action buttons on issue detail.
- Provides "Reset chain depth" button when chain depth limit is reached.

**Backend (Node.js + TypeScript)**
- Exposes REST API (versioned at `/api/v1`) for CRUD operations on projects, issues, comments; crew is read-only (fixed constants).
- All request validation via Zod schemas.
- Centralized error handling middleware (all errors formatted as `{ error: { code, message, details } }`).
- Runs WebSocket server (`ws` library) to push real-time events to the frontend.
- In-process event bus (typed EventEmitter) for decoupled internal communication between components.
- Manages agent lifecycle — spawning `claude -p` processes, tracking active processes, enforcing concurrency limits.
- Graceful shutdown on SIGTERM/SIGINT — kills active agent processes.
- Structured JSON logging via pino.
- CORS enabled for local frontend development.

**MentionHandler**
- Subscribes to `comment.added` events.
- Parses `/dispatch` commands from comment text via MentionParser.
- Enforces chain depth and concurrency limits.
- Performs per-agent-per-issue deduplication (skips if agent already running for issue).
- Spawns `claude -p` processes via ProcessAdapter.
- Posts agent output and system notifications back as comments.
- See [Agent Runtime](agent-runtime.md) for the full specification.

**ProcessAdapter**
- Spawns `claude -p` as a child process.
- Captures stdout (JSON output format) and resolves on process exit.
- Enforces 10-minute timeout per process.

**PR Detector**
- Subscribes to `comment.added` events.
- Parses GitHub PR URLs from comment text.
- Matches URLs against repos linked to the project.
- Creates `IssuePR` records for new PRs (deduped by repo + PR number).
- Emits `pr.created` for each newly linked PR.

**PR Poller**
- Runs every 60 seconds (started at startup, stopped on shutdown).
- Queries all open `IssuePR` records with their project/repo context.
- Fetches current PR state from the GitHub API using the project's OAuth token.
- Updates `IssuePR.status` when a PR is merged or closed.
- Auto-transitions the linked issue from `pr_created` → `done` when a PR is merged.
- Emits `pr.status_changed` and `issue.status_changed` events accordingly.

**Event Bus**
- In-process typed EventEmitter singleton.
- All internal components communicate through the event bus rather than calling each other directly.
- Producers: REST API handlers, MentionHandler, PR Detector, PR Poller.
- Consumers: MentionHandler, PR Detector, WebSocket broadcaster, Activity Logger.
- Fire-and-forget — emitters do not wait for consumers to finish processing.

**SQLite Database**
- Stores all persistent state: projects, issues, comments, activity logs. (Agents are fixed constants in code, not persisted.)
- Accessed via `better-sqlite3` with raw SQL (synchronous API).
- Single `schema.sql` file executed on startup for migrations.
- Single file, no external dependencies, suitable for local-first operation.
- See [Data Model](data-model.md) for the full schema.

## Event Bus

The backend uses an in-process typed EventEmitter as the central communication backbone.

### Event Flow

```
┌──────────────────────────────────────────────────────────┐
│                     Event Bus                            │
│              (typed EventEmitter singleton)               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Producers:                    Consumers:                │
│  ├── REST API handlers    ──→  MentionHandler            │
│  ├── MentionHandler       ──→  WebSocket broadcaster     │
│  └── PR Detector/Poller   ──→  Activity Logger           │
│                           ──→  PR Detector               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Behavior

- **Fire-and-forget** — producers emit events and move on. Consumers handle errors independently.
- Events are processed synchronously within the Node.js event loop.
- Every event bus event maps to a corresponding WebSocket event for frontend notification.

### Example Flow: User Posts a Comment with /dispatch

```
1. REST API: POST /api/v1/projects/:id/issues/:issueId/comments
2. API handler creates Comment in DB
3. API handler emits: bus.emit("comment.added", { comment, project_id })
4. Activity Logger receives event → writes ActivityLog entry
5. WebSocket broadcaster receives event → sends to connected frontend clients
6. MentionHandler receives event → parses /dispatch commands → spawns agent processes
7. PR Detector receives event → parses PR URLs → creates IssuePR records
8. API handler returns 201 to the client
```

## Real-Time Communication

All state changes are broadcast to connected frontend clients via WebSocket:

- **Issue events** — created, status changed, comment added, comment updated, comment deleted.
- **Agent events** — mention spawned, mention completed, chain depth reached, dispatch queued, dispatch dequeued.
- **PR events** — PR created, status updated.

The frontend subscribes to events scoped by project.

## Execution Model

### Agent Process Lifecycle

Each `/dispatch` command spawns a one-shot `claude -p` process:

```
1. comment.added event fires
      ↓
2. MentionHandler parses /dispatch commands
      ↓
3. Per-agent-per-issue deduplication check (skip if already running)
      ↓
4. Chain depth checked (atomic DB increment, max 20)
      ↓
5. Concurrency checked (active processes < max_concurrency)
      → if limit reached: dispatch queued; system comment posted; stops here
      ↓
6. Issue status regressed to in_progress if needed
      ↓
7. Worktree created if needed
      ↓
8. Prompt built from issue + comments
      ↓
9. ProcessAdapter.spawnClaude() → child process starts
      ↓
10. Process runs (10-minute timeout)
      ↓
11. On exit: stdout parsed, posted as agent comment
```

### Git Worktree Isolation

Each issue gets its own git worktree:

- When an agent is first spawned on an issue, a new worktree is created from the project repo's default branch.
- The worktree path and branch name are recorded on the issue and reused for subsequent agent spawns on the same issue.

### Concurrency Control

- Each project has a configurable concurrency limit (`max_concurrency`).
- The MentionHandler counts active processes for the project before each spawn.
- If the limit is reached, the dispatch is placed in an in-memory per-project FIFO queue and a system comment is posted with the queue position. When a running process exits, the handler dequeues the next pending dispatch and spawns it automatically. Queued dispatches are lost on restart.

## Process Lifecycle

### Startup

On startup, the backend:

1. Loads configuration from environment variables (`.env` file).
2. Initializes SQLite database (runs `schema.sql` if tables don't exist).
3. Initializes the activity logger (registers event listeners).
4. Initializes the MentionHandler (subscribes to `comment.added`).
5. Initializes the PR detector (subscribes to `comment.added` for auto-linking PRs).
6. Starts the PR poller (polls GitHub every 60 seconds for PR status updates).
7. Starts the Express HTTP server.
8. Starts the WebSocket server.
9. Logs startup complete via pino.

Note: any agent processes spawned before a crash are lost on restart (no in-memory state recovery).

### Graceful Shutdown

On SIGTERM or SIGINT, the backend:

1. Stops accepting new HTTP connections.
2. Sends SIGTERM to all active agent processes (via `shutdownMentionHandler()`).
3. Stops the PR poller.
4. Closes the SQLite database connection.
5. Exits the process.

## Security and Access

- GitHub authentication is managed in-app via Device Flow OAuth (Settings → GitHub Accounts). No host-level `gh auth login` is required.
- OAuth tokens are stored in SQLite and injected as `GH_TOKEN` into agent processes at spawn time. They are never persisted in `.git/config`.
- Each project can be linked to a specific GitHub account, enabling per-project identity for git operations.
- The system runs locally — no data leaves the machine except through GitHub API calls.
- Full audit trail of all agent actions is maintained in the database.

## Future Considerations

- **Additional CLI tool adapters** — support for tools other than Claude Code.
- **Remote execution** — running agents on remote servers instead of local processes.
- **Multi-user support** — multiple humans overseeing the same project.
- **Integration with external trackers** — syncing issues with GitHub Issues, Linear, or Jira.
