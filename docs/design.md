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
- A shared roster of 5 fixed agents (defined globally, not per-project; 4 dispatchable + Captain).
- A concurrency limit (max simultaneous agent processes).
- A chain depth limit (max agent dispatches per issue before requiring manual reset).
- A default Claude model (`sonnet` or `opus`) for agent spawning, with optional per-agent overrides via AgentConfig.

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

Pull requests are tracked in the `IssuePR` table. They can be linked to an issue in four ways:

- **Manual**: the user clicks "Mark as PR Created", which transitions the issue to `pr_created` and records the PR.
- **Auto-link**: when a comment is posted containing a GitHub PR URL (e.g. `https://github.com/owner/repo/pull/123`), the PR detector automatically creates an `IssuePR` record linking it to the issue (deduped by repo + PR number).
- **Agent registration**: An agent can call `POST /internal/create-pr` after creating a PR with `gh pr create` to explicitly register the PR for tracking. This ensures the PR poller can auto-transition the issue to `done` when the PR is merged.
- **Captain create-pr action**: The Captain Monitor can create a PR directly via the `create-pr` action plan type. This calls the GitHub API (`POST /repos/{owner}/{repo}/pulls`), creates an `IssuePR` record, emits `pr.created`, and transitions the issue to `pr_created`. The PR body uses a structured format with Summary and Description sections.

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

Dispatching an agent on any PR-related status (`pr_created`, `pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`) or `done` issue automatically regresses it to `in_progress`. However, if the issue has a merged PR (recorded in the `issue_prs` table), the dispatch is rejected with a system comment and the status is not regressed. This prevents accidental re-opening of completed work.

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
│  │Terminals │ │ Activity │ │ Captain (Chat)   │ │
│  │+ Monitor │ │   Log    │ │                  │ │
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
│  │  Captain (Monitor)                          │ │
│  │  Monitor: events → stream-json → action plan│ │
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

- Renders project dashboard, issue board, crew page (`/projects/:id/crew`), activity log, Terminals page, and Captain page (side-by-side Chat + Monitor). The crew page is project-scoped and allows per-agent model overrides: each agent card has a model dropdown ("Project default", "Sonnet", "Opus"). Selecting "Project default" removes the override (`DELETE /projects/:id/agent-config/:agentId`); selecting a model saves it (`PUT /projects/:id/agent-config/:agentId`). Captain is included in the list since it runs Claude processes. The sidebar surfaces "Crew" as a per-project nav item linking to `/projects/:id/crew`.
- Connects to backend via WebSocket for real-time updates (comments, status changes, agent activity). The project layout (`+layout.svelte`) establishes shared context for WebSocket and agents data, loaded once and shared to all child pages via Svelte `setContext`/`getContext`. The layout also includes a `<div id="modal-portal">` element as a sibling to `<main>` for rendering modals outside the scroll container.
- **Modal rendering**: Modals use a portal pattern to prevent scroll jumps. `Modal.svelte` uses a Svelte action (`use:portal`) to append modal content to `#modal-portal`, which is outside the `<main class="overflow-auto">` scroll container. This prevents the browser from auto-scrolling when modals are inserted into the DOM.
- **Terminals page** (`/projects/:id/terminals`) — mission-control grid of live agent panes and the Captain monitor feed. Uses `GET /projects/:id/active-runs` for initial data and subscribes to `run.started`, `run.event`, `run.completed` WebSocket events for live updates. Each agent pane shows agent name, status badge, clickable issue link, an event feed with full content display, and elapsed time + cost. Events show their full content: assistant thinking/response text, user messages, tool call details (file paths, commands, patterns), and tool results. The feed auto-scrolls to new events when the user is at the bottom but preserves scroll position when the user has scrolled up to read history. The page also displays a **Captain monitor card** with cyan accent styling, which shows the automated orchestration feed. The monitor card loads history via `GET /projects/:projectId/monitor/history` on mount and subscribes to `monitor.event_received`, `monitor.thinking`, `monitor.message`, `monitor.tool_call`, `monitor.tool_result`, `monitor.complete` WebSocket events for live updates. It displays "Analyzing..." during active processing and "Monitoring" when idle. Only agents with active runs are shown — idle agents are hidden; the grid renders only the Captain card and any agents with running/queued runs.
- **Captain page** (`/projects/:id/chat`) — PTY-backed terminal interface for direct CLI access to captain. Uses xterm.js for terminal rendering and connects to the backend via `/terminal-ws` WebSocket for bidirectional PTY streaming. The terminal component (`Terminal.svelte`) handles resize events, reconnection with exponential backoff, and FitAddon/WebLinksAddon integration. The page auto-creates a terminal session if none exists via `POST /projects/:id/terminal`.
- Issue detail page (`[issueId]/+page.svelte`) is a thin orchestrator (~360 lines) that loads data, manages comment CRUD state, subscribes to WebSocket events, and passes props to focused child components:
  - **`IssueTimeline.svelte`** — renders the unified chronological timeline merging comments, activity entries, and agent run summaries. Accepts `comments`, `activityEntries`, `runs`, and `liveEvents` props. Owns activity expansion state and inline run expansion (loads run events on toggle, appends live events via a reactive `$effect`). Matches `mention.spawned`/`mention.completed` activity entries to `AgentRun` records by `agent_id` + timestamp (60s tolerance) and displays colored status dots (green = running, amber = queued, red = failed, cyan = completed). Stale-fetch guard: captures `runId` before async calls and checks it after await before updating state.
  - **`RunDetailModal.svelte`** — modal showing the full event log for a selected run. Accepts a `run` prop and a `liveEvents` map. Loads events from the API on open, merges in any already-received live events, then appends new live events via a second `$effect` that uses `untrack()` to read `modalEvents` without creating a reactive dependency. Stale-fetch guard: captures `runId` before the API call and checks `runId !== run?.id` before assigning results.
  - **`DispatchInput.svelte`** — comment textarea with `/dispatch` autocomplete dropdown. Reads the `agents` list from Svelte context (`getContext('agents')`). Accepts `onSubmit` callback and `posting` prop. Owns all autocomplete state (`showMentions`, `mentionFilter`, `mentionIdx`, `textareaEl`) and keyboard navigation logic. Emits comment text via `onSubmit` on submit.
- Provides autocomplete for `/dispatch` commands in comment input (via `DispatchInput.svelte`).
- Provides "Mark as PR Created" and "Mark as Done" action buttons on issue detail.
- Provides "Reset chain depth" button when chain depth limit is reached.

**Backend (Node.js + TypeScript)**

- Exposes REST API (versioned at `/api/v1`) for CRUD operations on projects, issues, comments; crew is read-only (fixed constants).
- All request validation via Zod schemas. Issue and PR status fields use Zod enum validation against centralized constants (`backend/src/constants/statuses.ts`).
- Centralized error handling middleware (all errors formatted as `{ error: { code, message, details } }`).
- Runs WebSocket server (`ws` library) to push real-time events to the frontend.
- Runs separate terminal WebSocket server (`/terminal-ws`) for PTY streaming.
- In-process event bus (typed EventEmitter) for decoupled internal communication between components.
- Manages agent lifecycle — spawning `claude -p` processes, tracking active processes, enforcing concurrency limits.
- Manages terminal sessions — persistent tmux sessions running Claude CLI with 30-minute idle timeout cleanup.
- Graceful shutdown on SIGTERM/SIGINT — kills active agent processes and terminal sessions.
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
- Parses PR URLs from comment text using registered VCS provider clients (currently GitHub only).
- Matches URLs against repos linked to the project.
- Creates `IssuePR` records for new PRs (deduped by repo + PR number).
- Emits `pr.created` for each newly linked PR.

**PR Poller**

- Runs every 60 seconds (started at startup, stopped on shutdown).
- Queries all open `IssuePR` records with their project/repo context.
- Fetches current PR state from the VCS provider (currently GitHub only) using the project's OAuth token.
- Updates `IssuePR.status` when a PR is merged or closed.
- Auto-transitions the linked issue to `done` when a PR is merged (regardless of current status, unless already `done`).
- For open PRs, also checks:
  - **Merge conflicts** — via the `mergeable` field. If `false`, transitions issue to `pr_conflict`.
  - **CI status** — checks all configured CI systems. If any check failed, transitions issue to `pr_failed_actions`. If all checks pass and mergeable, transitions to `pr_ready_to_merge`.
- Issues in intermediate states (`pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`) are transitioned back to `pr_created` when conditions become pending (e.g., new commits pushed).
- Emits `pr.status_changed` and `issue.status_changed` events accordingly.
- Exports `pollPRs()` for external callers to trigger immediate polling.

**VCS Provider Abstraction**

- All VCS-specific operations (GitHub, GitLab, etc.) are abstracted behind a `VCSProviderClient` interface (`backend/src/vcs/types.ts`).
- GitHub implementation in `backend/src/vcs/github/client.ts` handles URL parsing, repo metadata, PR operations, and CI status checks.
- Provider registry (`backend/src/vcs/registry.ts`) allows registration of multiple VCS providers and URL-based provider detection.
- Ready for multi-VCS support — adding GitLab or Bitbucket requires only implementing the interface.

**Captain (Monitor only)**

Captain runs a single Monitor service per project. Captain always runs for all projects — there is no on/off toggle. The `auto_start` and `auto_merge` settings control what Captain can do autonomously. Captain is a background service and is not dispatchable via `/dispatch`.

**Monitor Service** (`backend/src/orchestration/captain/monitor-service.ts` + `monitor-agent.ts`)

- Automated event-driven orchestrator — no polling. Wakes only when events occur:
  - `issue.created` (user-created issues only — agent-created issues are ignored to prevent chain reactions)
  - `issue.updated`, `issue.status_changed`
  - `run.completed` (agent finished)
  - `startup.scan` (emitted when monitor service starts for each project — gives Captain full visibility into existing issues)
  - `pr.status_changed` (from PR poller)
  - `comment.added` (user comments only)
  - `project.settings_changed` (project configuration updates — e.g., `auto_merge_enabled`, `max_concurrency`)
  - `idle.check` (configurable per-project idle timeout)
- Has its own queue namespace (`monitor:{projectId}`) — a long monitor batch won't block user chat, and vice versa.
- Event batching: accumulates events while processing, drains all pending events at once.
- Uses `claude -p --output-format stream-json` for orchestration decisions with read-only tool access.
- **Structured action plans**: Instead of making curl calls for write operations, the Monitor outputs a JSON action plan that the backend executes deterministically. This enables parallel dispatch execution and faster mutex release.
- Maintains its own conversation history (last 100 sessionless messages in ChatMessage table, i.e. `session_id IS NULL`), separate from chat session history.
- **Read-only curl access**: Monitor can still use curl for read operations (list issues, get issue details, list knowledge) to gather state before making decisions.
- **Action types**: dispatch, merge, scan, comment, create-issue, update-issue, create-pr, skip. Action schemas are validated with Zod (`action-schema.ts`) and executed by `plan-executor.ts`. Before execution, any truncated issue ID prefixes (≥8 chars but shorter than a full UUID) are resolved to full UUIDs via a project-scoped prefix match in the database.
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

- Thin wrapper that initializes and shuts down the Monitor service.
- `initCaptain()` starts the Monitor service for all captain-enabled projects.
- `startCaptainForProject(projectId)` / `stopCaptainForProject(projectId)` control the Monitor service per project.
- Uses OAuth token from the project's linked GitHub account for merging and PR creation.

**PTY Service** (`backend/src/orchestration/captain/pty-service.ts`)

- Manages persistent tmux sessions running Claude CLI for terminal access to captain chat.
- Each project can have one terminal session running `claude --system-prompt-file` inside tmux.
- **Worktree isolation**: Creates a long-lived git worktree per project (named `crewdeck/captain-{projectId}`) in `/tmp/crewdeck-worktrees/`. The worktree persists across PTY reconnects and auto-rebases onto the latest default branch on creation. Terminal sessions run with the worktree as the working directory.
- **Enriched system prompt**: Injects project knowledge (workflows/conventions), API reference (Issues, Runs, Activity, Knowledge APIs), current capacity (running agents, available slots), project settings (auto-start, auto-merge), and repository context.
- Session lifecycle: `createTerminalSession()`, `getTerminalSession()`, `destroyTerminalSession()`.
- Auto-cleanup: 30-minute idle timeout kills sessions and removes temporary files (system prompt, SSH keys). Worktrees persist and are reused across session recreations.
- Environment injection: `CREWDECK_*` vars, `GH_TOKEN`, SSH keys from project's GitHub account.
- Concurrency control: `pendingCreations` Set guards against race conditions when multiple clients request sessions simultaneously.

**Terminal WebSocket Server** (`backend/src/terminal-ws.ts`)

- Separate WebSocket server on `/terminal-ws?projectId={id}` path.
- Spawns `node-pty` process attaching to the project's tmux session via `tmux attach-session -t {name}`.
- Bidirectional I/O: PTY output → WebSocket send (raw bytes), WebSocket messages → PTY write (keyboard input).
- Resize handling: JSON messages with `{ type: "resize", cols, rows }` → `pty.resize()`.
- Connection cleanup: kills PTY attach process on disconnect (does not kill the tmux session itself).

**Event Bus**

- In-process typed EventEmitter singleton.
- All internal components communicate through the event bus rather than calling each other directly.
- Producers: REST API handlers, MentionHandler, PR Detector, PR Poller, Chat Service, Monitor Service, VCS Provider clients.
- Consumers: MentionHandler, PR Detector, WebSocket broadcaster, Activity Logger, Chat Service, Monitor Service, Worktree Cleanup.
- Fire-and-forget — emitters do not wait for consumers to finish processing.

**SQLite Database**

- Stores all persistent state: projects, issues, comments, activity logs. (Agents are fixed constants in code, not persisted.)
- Accessed via `better-sqlite3` with raw SQL (synchronous API).
- File-based migration system in `backend/src/db/migrations/`. Migrations are the single source of truth — there is no separate `schema.sql`. Fresh databases run all migrations from `000_initial_schema.sql` to the latest.
- Versioned migration system (`_migrations` table) tracks which migrations have run. Each migration runs idempotently — it checks whether its changes are already present before executing, making it safe for both fresh and existing databases. Destructive migrations (table recreation) are wrapped in transactions with `foreign_keys = OFF`.
- Standalone migration commands: `npm run migrate` (run migrations) and `npm run migrate:create -- description` (scaffold new migration).
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
│  ├── REST API handlers    ──→  Orchestrator Manager      │
│  ├── Agent Runtime        ──→  WebSocket broadcaster     │
│  ├── REST API handlers    ──→  MentionHandler            │
│  ├── MentionHandler       ──→  WebSocket broadcaster     │
│  ├── PR Detector/Poller   ──→  Activity Logger           │
│  ├── Monitor Service      ──→  PR Detector               │
│  │                        ──→  Monitor Service (events)   │
│  └── Worktree Cleanup     ──→  Worktree Cleanup           │
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
7. PR Detector receives event → parses PR URLs via VCS providers → creates IssuePR records
8. API handler returns 201 to the client
```

### Example Flow: Issue Reaches Done Status

```
1. REST API: PATCH /api/v1/projects/:id/issues/:issueId (status: "done")
2. API handler updates issue status in DB
3. API handler emits: bus.emit("issue.status_changed", { issue_id, project_id, from: "in_progress", to: "done" })
4. Worktree Cleanup listener receives event → cleans up git worktree, always clears DB fields (in finally block)
5. Activity Logger receives event → writes ActivityLog entry
6. WebSocket broadcaster receives event → sends to connected frontend clients
7. API handler returns 200 to the client
```

## Real-Time Communication

All state changes are broadcast to connected frontend clients via WebSocket:

- **Issue events** — created, status changed, comment added, comment updated, comment deleted.
- **Agent events** — mention spawned, mention completed, chain depth reached, dispatch queued, dispatch dequeued. The Terminals page subscribes to `run.started`, `run.event`, and `run.completed` for live agent activity feeds.
- **PR events** — PR created, status updated.
- **Monitor events** — event received, thinking, message, tool call, tool result, complete.

The frontend subscribes to events scoped by project. All event payloads are strongly typed via a `WsEventMap` interface (`frontend/src/lib/api/types.ts`) that maps each event name to its payload type. `ProjectWebSocket.on()` uses generic overloads so handlers receive typed `data` parameters with full IDE autocomplete.

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

**Automatic Cleanup:**

Worktrees are automatically cleaned up via event-driven and synchronous mechanisms:

- **Event-driven cleanup (`initWorktreeCleanup()`)** — Listens for `issue.status_changed` events with `to === "done"`. When triggered:
  1. Checks if worktree path exists on disk
  2. Calls `cleanupWorktree()` to remove git worktree and branch
  3. **Always clears** `worktree_path` and `branch_name` DB fields (via `finally` block), regardless of cleanup success
  4. Logs warnings on failure but continues (cleanup errors are non-fatal)

- **Synchronous cleanup on deletion** — DELETE `/issues/:issueId` and POST `/issues/:issueId/discard` routes call cleanup before deleting database records to prevent worktree leaks

This approach ensures:
- No unbounded disk usage from abandoned worktrees
- Database never points to broken or partially-cleaned worktree state
- Cleanup failures don't block issue status transitions or deletions
- Early exit optimization when path already gone (no unnecessary git operations)

### Concurrency Control

- Two-level concurrency limits:
  - **Global limit** (`MAX_AGENTS` env var, default 10): maximum agents running across all projects
  - **Per-project limit** (`max_concurrency`): maximum agents per project
- The MentionHandler checks both limits before each spawn.
- If either limit is reached, the dispatch is placed in a DB-backed FIFO queue (using `AgentRun` table with `status='queued'`) and a system comment is posted with the queue position. When a running process exits, the handler dequeues the next pending dispatch and spawns it automatically. Queued runs persist across server restarts.

## Process Lifecycle

### Startup

On startup, the backend:

1. Loads configuration from environment variables (`.env` file).
2. Initializes SQLite database (runs all pending migrations from `backend/src/db/migrations/`).
3. Initializes the activity logger (registers event listeners).
4. Initializes the worktree cleanup listener (subscribes to `issue.status_changed`).
5. Initializes the MentionHandler (subscribes to `comment.added`).
6. Initializes the PR detector (subscribes to `comment.added` for auto-linking PRs).
7. Starts the PR poller (polls VCS providers every 60 seconds for PR status updates).
8. Initializes Captain Monitor service — subscribes to the event bus for all captain-enabled projects.
9. Initializes PTY service — starts idle session cleanup interval (runs every 60 seconds).
10. Starts the Express HTTP server.
11. Starts the WebSocket server (`/ws` for events).
12. Starts the terminal WebSocket server (`/terminal-ws` for PTY streaming).
13. Logs startup complete via pino.

Note: any agent processes spawned before a crash are lost on restart (no in-memory state recovery). Terminal sessions are also lost (clients must reconnect and recreate sessions).

### Graceful Shutdown

On SIGTERM or SIGINT, the backend:

1. Stops accepting new HTTP connections.
2. Sends SIGTERM to all active agent processes (via `shutdownMentionHandler()`).
3. Shuts down Captain Monitor service — unsubscribes from events and clears idle timeouts.
4. Shuts down PTY service — kills all active tmux sessions and cleans up temporary files.
5. Closes terminal WebSocket connections and kills all PTY attach processes.
6. Stops the PR poller.
7. Closes the SQLite database connection.
8. Exits the process.

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
