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
- Knowledge entries for project context (conventions, structure notes, gotchas) injected into agent prompts.
- One or more linked GitHub repositories.
- A shared roster of 4 fixed agents (defined globally, not per-project).
- A concurrency limit (max simultaneous agent processes).
- A chain depth limit (max agent dispatches per issue before requiring manual reset).

### Agent

The crew is a fixed set of 5 immutable agents defined in code (Engineer, Lead, Docs, Librarian, Captain). Each has a name, title, description, and system prompt. They are not stored in the database and cannot be created, modified, or deleted.

Agent names are used for `/dispatch` command matching. Captain is a background service and is not dispatchable via `/dispatch`.

### Orchestration via /dispatch Commands

Orchestration is driven by `/dispatch` commands in issue comments. When a user or agent posts a comment containing `/dispatch agent-name` at the start of a line, the backend spawns that agent as a `claude -p` subprocess. The agent runs to completion and posts its output back as a comment. If the agent's output includes a `/dispatch` command, that agent is spawned in turn.

`@mentions` are cosmetic references only — they do NOT trigger agent spawns. This prevents duplicate spawns when agents reference each other in summaries or feedback.

A single `/dispatch` line can list multiple agents (space-separated), e.g., `/dispatch engineer lead`. When multiple agents are dispatched, they are grouped as a batch and spawned immediately.

The chain depth is tracked per issue (capped at the project's `max_chain_depth` setting, default 20) to prevent infinite loops. Concurrency is bounded by the project's `max_concurrency` setting.

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

Pull requests are tracked in the `IssuePR` table. They can be linked to an issue in three ways:

- **Manual**: the user clicks "Mark as PR Created", which transitions the issue to `pr_created` and records the PR.
- **Auto-link**: when a comment is posted containing a GitHub PR URL (e.g. `https://github.com/owner/repo/pull/123`), the PR detector automatically creates an `IssuePR` record linking it to the issue (deduped by repo + PR number).
- **Agent registration**: An agent can call `POST /internal/create-pr` after creating a PR with `gh pr create` to explicitly register the PR for tracking. This ensures the PR poller can auto-transition the issue to `done` when the PR is merged.

## Issue Lifecycle

```
Open → In Progress → PR Created → Done
                          │
                          ├─→ PR Conflict
                          ├─→ PR Failed Actions
                          └─→ PR Ready to Merge → Done
```

### States

| State                 | Description                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Open**              | Issue is in the queue, ready to be worked on.                                                                                             |
| **In Progress**       | An agent is actively working (or has worked) on the issue. Set automatically when an agent is spawned.                                    |
| **PR Created**        | A pull request has been created. Set via the "Mark as PR Created" button, or auto-detected when a PR URL is posted in a comment.          |
| **PR Conflict**       | The PR has merge conflicts detected by GitHub. Transitions back to `pr_created` after conflicts are resolved.                             |
| **PR Failed Actions** | The PR has failing CI checks. Transitions back to `pr_created` after checks pass.                                                         |
| **PR Ready to Merge** | The PR passes all checks and has no conflicts. Ready to be merged.                                                                        |
| **Done**              | Issue resolved. Set via the "Mark as Done" button (blocked if active processes are running), or automatically when a linked PR is merged. |

Dispatching an agent on any PR-related status (`pr_created`, `pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`) or `done` issue automatically regresses it to `in_progress`.

## Technology Decisions

| Component              | Choice                          | Rationale                                                                                       |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Backend language**   | TypeScript                      | Type safety, shared types with frontend                                                         |
| **HTTP framework**     | Express                         | Widely adopted, mature ecosystem                                                                |
| **Database**           | SQLite via `better-sqlite3`     | Synchronous API (performance advantage for SQLite), no async overhead, raw SQL for full control |
| **Request validation** | Zod                             | Strict schema validation, self-documenting, TypeScript integration                              |
| **WebSocket**          | `ws`                            | Minimal, no abstraction overhead                                                                |
| **Testing**            | Vitest + supertest              | Vitest for unit tests; supertest for HTTP integration tests                                     |
| **Logging**            | pino                            | Fast structured JSON logging                                                                    |
| **Frontend framework** | SvelteKit (Svelte 5 with runes) | Fine-grained reactivity, minimal boilerplate                                                    |
| **CSS**                | Tailwind CSS                    | Utility-first, dark theme, no component library                                                 |
| **Configuration**      | Environment variables (`.env`)  | Simple, standard approach                                                                       |
| **Agent spawning**     | `claude -p` (print mode)        | One-shot process per mention; no persistent sessions to manage                                  |

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
│  │Terminals │ │ Activity │ │ Captain (Chat +  │ │
│  │  (live)  │ │   Log    │ │ Monitor split)   │ │
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
│  │  Captain (Chat + Monitor)                   │ │
│  │  Chat:  chat.message → stream-json → WS     │ │
│  │  Monitor: events → claude -p → actions       │ │
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

- Renders project dashboard, issue board, crew (read-only), activity log, Terminals page, and Captain page (side-by-side Chat + Monitor).
- Connects to backend via WebSocket for real-time updates (comments, status changes, agent activity).
- **Terminals page** (`/projects/:id/terminals`) — mission-control grid of live agent panes. Uses `GET /projects/:id/active-runs` for initial data and subscribes to `run.started`, `run.event`, `run.completed` WebSocket events for live updates. Each pane shows agent name, status badge, clickable issue link, an event feed with full content display, and elapsed time + cost. Events show their full content: assistant thinking/response text, user messages, tool call details (file paths, commands, patterns), and tool results. The feed auto-scrolls to new events when the user is at the bottom but preserves scroll position when the user has scrolled up to read history. Empty state displays the crew roster in an idle state.
- **Captain page** (`/projects/:id/chat`) — side-by-side layout with Chat panel (left) and Monitor panel (right). On desktop, both panels display simultaneously. On mobile, a tab bar ([Chat] [Monitor]) switches between full-width views. The sidebar has a single "Captain" entry.
  - **Chat panel** (`ChatPanel.svelte`): interactive conversation with input area, session selector, markdown rendering, image paste support. Subscribes to `captain.chat.chunk` (token-by-token streaming), `captain.chat.tool_call`, `captain.chat.tool_result`, `captain.chat.complete`, and legacy `captain.thinking`/`captain.message`/`captain.complete` events. Includes a 60-second safety timeout that resets the sending state if no completion event arrives.
  - **Monitor panel** (`MonitorPanel.svelte`): read-only event feed of automated orchestration decisions. Color-coded entries: events (yellow), monitor decisions (cyan), tool calls/results (purple). Subscribes to `monitor.event_received`, `monitor.thinking`, `monitor.message`, `monitor.tool_call`, `monitor.tool_result`, `monitor.complete`. Auto-scrolls on new entries with timestamps.
- Issue detail page shows a unified Timeline view merging comments, activity, and agent run summaries chronologically. Both `mention.spawned` and `mention.completed` entries are matched to `AgentRun` records (by `agent_id` + `started_at` or `completed_at` timestamp within 60s tolerance) and display colored status dots (green = running, amber = queued, red = failed, cyan = completed) and a "View" link that opens a modal with the run's full event log, live-updated via WebSocket.
- Provides autocomplete for `/dispatch` commands and `@mentions` in comment input.
- Provides "Mark as PR Created" and "Mark as Done" action buttons on issue detail.
- Provides "Reset chain depth" button when chain depth limit is reached.

**Backend (Node.js + TypeScript)**

- Exposes REST API (versioned at `/api/v1`) for CRUD operations on projects, issues, comments; crew is read-only (fixed constants).
- All request validation via Zod schemas. Issue and PR status fields use Zod enum validation against centralized constants (`backend/src/constants/statuses.ts`).
- Centralized error handling middleware (all errors formatted as `{ error: { code, message, details } }`).
- Runs WebSocket server (`ws` library) to push real-time events to the frontend.
- In-process event bus (typed EventEmitter) for decoupled internal communication between components.
- Manages agent lifecycle — spawning `claude -p` processes, tracking active processes, enforcing concurrency limits.
- Graceful shutdown on SIGTERM/SIGINT — kills active agent processes.
- Structured JSON logging via pino.

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
- Auto-transitions the linked issue to `done` when a PR is merged (regardless of current status, unless already `done`).
- For open PRs, also checks:
  - **Merge conflicts** — via the `mergeable` field. If `false`, transitions issue to `pr_conflict`.
  - **CI status** — via both GitHub check-runs API (modern) and commit status API (legacy). If any check failed, transitions issue to `pr_failed_actions`. If all checks pass and mergeable, transitions to `pr_ready_to_merge`.
- Issues in intermediate states (`pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`) are transitioned back to `pr_created` when conditions become pending (e.g., new commits pushed).
- Emits `pr.status_changed` and `issue.status_changed` events accordingly.
- Exports `pollPRs()` for external callers to trigger immediate polling.

**Captain (Chat + Monitor)**

Captain is split into two independent services that run concurrently per project. Captain always runs for all projects — there is no on/off toggle. The `auto_start` and `auto_merge` settings control what Captain can do autonomously. Captain is a background service and is not dispatchable via `/dispatch`.

**Chat Service** (`backend/src/orchestration/captain/chat-service.ts` + `chat-agent.ts`)

- Handles interactive user conversations from the Captain chat UI.
- Subscribes to `chat.message` and `chat.abort` events.
- Uses `claude -p --output-format stream-json` for real-time token streaming to the frontend via `captain.chat.chunk` WebSocket events. Also emits `captain.chat.tool_call` and `captain.chat.tool_result` for tool use during chat. Falls back to `spawnClaudeMultimodal` for image-attached messages (non-streaming, emits full response as a single chunk).
- Messages are organized into sessions (ChatSession). Only one active session per project at a time; creating a new session archives the current active one.
- Each message is a one-shot `claude -p` call with conversation history from the active session as context.
- **Per-session concurrency**: one in-flight message per session. Additional sends are rejected with 409 (`SESSION_BUSY`). Multiple sessions can have in-flight messages simultaneously (separate processes). Session slots are reserved synchronously before any async work (process spawning, git auth setup) to prevent race conditions.
- **Abort handling**: users can abort in-flight messages via `POST /chat/sessions/:sessionId/abort`. The process is killed with SIGTERM → SIGKILL after 5s. Partial responses are discarded (not saved to DB). If abort is requested while the process is still being spawned (pending state), the process is killed immediately upon spawn.
- **Timeout**: 10-minute timeout per process, with SIGTERM → SIGKILL escalation.
- On completion, saves the full assistant response to ChatMessage table and emits `captain.chat.complete` with the saved message ID.

**Monitor Service** (`backend/src/orchestration/captain/monitor-service.ts` + `monitor-agent.ts`)

- Automated event-driven orchestrator — no polling. Wakes only when events occur:
  - `issue.created` (user-created issues only — agent-created issues are ignored to prevent chain reactions)
  - `issue.updated`, `issue.status_changed`
  - `run.completed` (agent finished)
  - `run.recovered` (issue needs attention after server restart)
  - `pr.status_changed` (from PR poller)
  - `comment.added` (user comments only)
  - `idle.check` (configurable per-project idle timeout)
- Has its own queue namespace (`monitor:{projectId}`) — a long monitor batch won't block user chat, and vice versa.
- Event batching: accumulates events while processing, drains all pending events at once.
- Uses `claude -p --output-format json` (batch, non-streaming) for orchestration decisions.
- Maintains its own conversation history (last 100 sessionless messages in ChatMessage table, i.e. `session_id IS NULL`), separate from chat session history.
- Available actions via curl to the internal API: merge PR, dispatch agent, create/update/list/get issues, add comments, scan codebase, manage knowledge.
- Decision priorities (encoded in system prompt, conditional on `auto_merge` and `auto_start` settings):
  1. **Merge ready PRs** — if PR is in `pr_ready_to_merge` status (when `auto_merge` is true); otherwise, **Report ready PRs** — note they are ready for manual merge
  2. **Fix broken PRs** — dispatch engineer for `pr_conflict` or `pr_failed_actions`
  3. **Update knowledge** — after a PR is merged, evaluate whether the changes warrant a librarian rescan (e.g., new files/modules, API changes, restructuring). Skip for bug fixes, style changes, dependency updates, or docs-only changes.
  4. **Start new work** — dispatch appropriate agent on open issues when capacity allows (when `auto_start` is true, skipping issues blocked by unfinished dependencies)
- When `auto_merge` is false, the merge action is excluded and a constraint is added preventing merge attempts.
- When `auto_start` is false, Captain will not automatically dispatch agents on new issues — the user must explicitly trigger dispatch.
- **Dependency awareness**: Before dispatching work on an issue, Monitor checks its description for dependency references (e.g., "depends on #12", "blocked by #14", "requires #", "after #", "waiting on #"). If a blocking issue is not yet in `done` or `pr_created` status, Monitor skips the blocked issue and works on unblocked ones instead. Blocked issues are re-evaluated when completion or merge events arrive for their blockers.
- Task-type reasoning: Monitor analyzes each issue and decides which agents to dispatch based on task type (research → librarian, docs-only → docs, code change → engineer then lead, etc.).

**Captain Wrapper** (`backend/src/orchestration/captain.ts`)

- Thin wrapper that initializes and shuts down both Chat and Monitor services together.
- `initCaptain()` starts both services for all captain-enabled projects.
- `startCaptainForProject(projectId)` / `stopCaptainForProject(projectId)` control both services per project.
- Uses OAuth token from the project's linked GitHub account for merging and PR creation.

**Event Bus**

- In-process typed EventEmitter singleton.
- All internal components communicate through the event bus rather than calling each other directly.
- Producers: REST API handlers, MentionHandler, PR Detector, PR Poller, Chat Service, Monitor Service.
- Consumers: MentionHandler, PR Detector, WebSocket broadcaster, Activity Logger, Chat Service, Monitor Service.
- Fire-and-forget — emitters do not wait for consumers to finish processing.

**SQLite Database**

- Stores all persistent state: projects, issues, comments, activity logs. (Agents are fixed constants in code, not persisted.)
- Accessed via `better-sqlite3` with raw SQL (synchronous API).
- `schema.sql` defines the full current schema and is executed on startup for fresh databases.
- Versioned migration system (`_migrations` table) tracks which migrations have run. Each migration runs idempotently — it checks whether its changes are already present before executing, making it safe for both fresh and existing databases. Destructive migrations (table recreation) are wrapped in transactions with `foreign_keys = OFF`.
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
│  ├── PR Detector/Poller   ──→  Activity Logger           │
│  ├── Chat Service         ──→  PR Detector               │
│  └── Monitor Service      ──→  Chat Service (chat.message)│
│                           ──→  Monitor Service (events)   │
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
- **Agent events** — mention spawned, mention completed, chain depth reached, dispatch queued, dispatch dequeued. The Terminals page subscribes to `run.started`, `run.event`, and `run.completed` for live agent activity feeds.
- **PR events** — PR created, status updated.
- **Captain events** — event received, thinking, message, tool call, tool result, complete.
- **Captain chat events** — chunk (streaming text), tool_call, tool_result, complete (session-scoped, granular streaming events).
- **Chat events** — stream, complete (legacy, kept for backward compatibility).

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
4. Chain depth checked (atomic DB increment, per project's max_chain_depth)
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
- On subsequent runs, the existing branch is rebased onto `origin/<defaultBranch>` to incorporate the latest main. If the rebase fails (e.g. conflicts), it is aborted and the agent continues with its existing branch state.

### Concurrency Control

- Each project has a configurable concurrency limit (`max_concurrency`).
- The MentionHandler counts active processes for the project before each spawn.
- If the limit is reached, the dispatch is placed in an in-memory per-project FIFO queue and a system comment is posted with the queue position. When a running process exits, the handler dequeues the next pending dispatch and spawns it automatically. Queued dispatches are lost on restart.

## Process Lifecycle

### Startup

On startup, the backend:

1. Loads configuration from environment variables (`.env` file).
2. Initializes SQLite database (runs `schema.sql` for fresh databases, then runs any pending versioned migrations).
3. Initializes the activity logger (registers event listeners).
4. Initializes the MentionHandler (subscribes to `comment.added`).
5. Initializes the PR detector (subscribes to `comment.added` for auto-linking PRs).
6. Starts the PR poller (polls GitHub every 60 seconds for PR status updates).
7. Initializes Captain services — both Chat and Monitor subscribe to the event bus for all captain-enabled projects.
8. Starts the Express HTTP server.
9. Starts the WebSocket server.
10. Logs startup complete via pino.

Note: any agent processes spawned before a crash are lost on restart (no in-memory state recovery).

### Graceful Shutdown

On SIGTERM or SIGINT, the backend:

1. Stops accepting new HTTP connections.
2. Sends SIGTERM to all active agent processes (via `shutdownMentionHandler()`).
3. Shuts down Captain services — both Chat and Monitor unsubscribe from events; Monitor clears idle timeouts.
4. Stops the PR poller.
5. Closes the SQLite database connection.
6. Exits the process.

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
