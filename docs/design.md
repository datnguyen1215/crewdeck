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
- A shared roster of 5 fixed agents (defined globally, not per-project; all are dispatchable).
- Agent model preferences are configured globally via the `/crew` page (not per-project).

### Agent

The crew is a fixed set of 5 immutable agents defined in code (Engineer, Lead, Docs, Librarian, Captain). Each has a name, title, description, and system prompt. They are not stored in the database and cannot be created, modified, or deleted.

Agent names are used for `/dispatch` command matching. All crew agents, including Captain, are dispatchable via `/dispatch`.

### Orchestration via /dispatch Commands

Orchestration is driven by `/dispatch` commands in issue comments. When a user or agent posts a comment containing `/dispatch agent-name` at the start of a line, the backend spawns that agent as a `claude -p` subprocess. The agent runs to completion and posts its output back as a comment. If the agent's output includes a `/dispatch` command, that agent is spawned in turn.

`@mentions` are cosmetic references only — they do NOT trigger agent spawns. This prevents duplicate spawns when agents reference each other in summaries or feedback.

A single `/dispatch` line can list multiple agents (space-separated), e.g., `/dispatch engineer lead`. When multiple agents are dispatched, they are grouped as a batch and spawned immediately.

The chain depth is tracked per issue (capped at the global `max_chain_depth` setting, default 20) to prevent infinite loops. Concurrency is bounded by the global `max_concurrency` setting.

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
- **Captain create-pr command**: Captain can create a PR by outputting `/create-pr <issue_id>` in a comment. The backend parses the command and calls the VCS provider to create the PR, creates an `IssuePR` record, emits `pr.created`, and transitions the issue to `pr_created`.

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

| Component              | Choice                          | Rationale                                                                                                                                                                          |
| ---------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backend language**   | TypeScript                      | Type safety, shared types with frontend                                                                                                                                            |
| **HTTP framework**     | Express                         | Widely adopted, mature ecosystem                                                                                                                                                   |
| **Database**           | SQLite via `better-sqlite3`     | Synchronous API (performance advantage for SQLite), no async overhead, raw SQL for full control                                                                                    |
| **Request validation** | Zod                             | Strict schema validation, self-documenting, TypeScript integration                                                                                                                 |
| **WebSocket**          | `ws`                            | Minimal, no abstraction overhead                                                                                                                                                   |
| **Testing**            | Vitest + supertest              | Vitest for unit tests; supertest for HTTP integration tests                                                                                                                        |
| **Logging**            | pino                            | Fast structured JSON logging                                                                                                                                                       |
| **Password hashing**   | bcrypt                          | Industry-standard, adaptive cost (≥ 12 rounds)                                                                                                                                     |
| **Frontend framework** | SvelteKit (Svelte 5 with runes) | Fine-grained reactivity, minimal boilerplate                                                                                                                                       |
| **CSS**                | Tailwind CSS                    | Utility-first, dark theme; shared UI primitives (`Button`, `TextInput`, `Select`) in `frontend/src/lib/components/ui/` enforce consistency without a third-party component library |
| **Configuration**      | Environment variables (`.env`)  | Simple, standard approach                                                                                                                                                          |
| **Agent spawning**     | `claude -p` (print mode)        | One-shot process per mention; no persistent sessions to manage. Chat threads use `--resume` for persistent Claude sessions.                                                      |

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
│  │ Cross-  │ │  Issue   │ │  Comment Thread  │ │
│  │Dashboard │ │  Board   │ │  (@mention UI)   │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────────────┐             │
│  │Terminals │ │ Chat (Threads)   │             │
│  └──────────┘ └──────────────────┘             │
│  ┌──────────┐ ┌──────────┐                     │
│  │  Login   │ │  Setup   │  (standalone pages) │
│  └──────────┘ └──────────┘                     │
│  │          │ │   Log    │ │                  │ │
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
│  │  Auth Middleware (session cookie or API key)  │ │
│  └──────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │  MentionHandler + ProcessAdapter            │ │
│  │  (comment.added → claude -p → comment)      │ │
│  │  + Command Execution (captain commands)     │ │
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

- Renders the cross-project Dashboard (`/dashboard`), project issue board, global crew page (`/crew`), activity log (Mission Control terminal at bottom of issues page showing activity entries with clickable issue title links), Terminals page, and Captain page (side-by-side Chat + Monitor). The Dashboard page uses a terminal-style UI aesthetic with a `$ crew status --all` command header and scanline overlay. It fetches all projects with stats via `GET /projects?stats` and active agent counts via `GET /global-config/active-agents`. The dashboard uses a two-column layout on desktop (lg breakpoint): a "Process List" panel on the left (2/3 width) and a "Mission Log" panel on the right (1/3 width). Both panels have terminal window chrome (macOS-style traffic light dots with title bar). The Process List displays projects in a table format with columns: ID (truncated 8-char UUID), PROJECT, OPEN, PROG, PR, BLK, RDY, DONE, AGENTS, and STATUS (idle/active based on `active_runs > 0`). Column headers are color-coded (OPEN=blue, PROG=amber, PR=purple, BLK=red, RDY=green, DONE=secondary, AGENTS=cyan). Active project rows have a subtle cyan background highlight. A summary line at the bottom shows aggregate counts (e.g., "3 projects │ 3/5 agents │ 2 in progress │ 164 done"). Both panels have a blinking cyan cursor at the bottom. The Mission Log is powered by a `DashboardActivityFeed` component that fetches the 10 most recent entries via `GET /activity` (global endpoint). Each entry is displayed in a two-line layout: line 1 shows context (`[HH:MM] ActorName > projectname > issue title`) and line 2 shows the action message (indented with `pl-12` to align with content). Each entry has a 3px left border colored by actor type (Captain/Lead=cyan, Engineer=green, Librarian/Docs=purple) and actor name colored to match. Issue titles use CSS `truncate` for overflow. Project name and issue title are conditionally shown (hidden when unavailable). Project name is desktop-only (`hidden md:inline`). Older entries fade out with decreasing opacity. Clicking an entry navigates to the relevant issue or project. The dashboard uses responsive layouts: card view on mobile and table view on desktop with keyboard-accessible rows that navigate via SvelteKit `goto()`. The entire dashboard (process list, activity feed, and agent counts) updates in real-time via the global WebSocket connection (`/ws?global=true`). Active Agents refreshes silently on `run.started` and `run.completed` events. A reconnecting indicator (amber banner) is shown when the WebSocket is disconnected. The crew page is global (not per-project) and includes a provider toggle at the top (Claude / Z.AI) that switches the active AI provider for all agent spawns. Each agent card has a model dropdown that shows provider-specific options: Claude models (Opus, Sonnet, Haiku) when Claude is selected, GLM models (GLM-5.1, GLM-5, GLM-5-Turbo, GLM-4.7) when GLM is selected. Model selections are saved per provider (`PUT /agent-config/:agentId` with `provider` + `model`), so switching providers automatically shows each agent's saved model for that provider. Removing an override falls back to the provider's default: `sonnet` for Claude, `glm-5-turbo` for GLM (`DELETE /agent-config/:agentId/:provider`). All agents including Captain are shown since they all run Claude CLI processes. The sidebar surfaces "Crew" as a global nav item linking to `/crew`. The sidebar uses accordion-style expansion for project submenus — only one project submenu is expanded at a time; expanding a new project collapses any previously expanded one. Utility links (Accounts, API Keys, Settings) are grouped under a collapsible "SYSTEM" section header at the bottom of the sidebar. The SYSTEM section uses the same toggle pattern as the PROJECTS section: a clickable header with chevron icon, with collapsed state persisted to localStorage (`sidebar-system-collapsed`). When the sidebar itself is collapsed (narrow mode), the SYSTEM header is hidden and the items render as icon-only links. The Log out button remains outside both sections and is always visible.
- Connects to backend via WebSocket for real-time updates (comments, status changes, agent activity). Per-project WebSocket connections are used for project-scoped updates (`/ws?projectId={id}`). The dashboard uses a separate global WebSocket (`/ws?global=true`) that receives events from all projects — used for real-time project stats and activity feed updates. The project layout (`+layout.svelte`) establishes shared context for WebSocket and agents data via Svelte `setContext`/`getContext`. Project and agents data are fetched using `fetchEffect` (from `$lib/utils/fetch-effect.svelte.js`), which handles cancellation on navigation and error toasts automatically — ensuring stale data from a previous project never overwrites state after rapid navigation, and agents re-fetch on remount. The layout also includes a `<div id="modal-portal">` element as a sibling to `<main>` for rendering modals outside the scroll container.
- **Modal rendering**: Modals use a portal pattern to prevent scroll jumps. `Modal.svelte` uses a Svelte action (`use:portal`) to append modal content to `#modal-portal`, which is outside the `<main class="overflow-auto">` scroll container. This prevents the browser from auto-scrolling when modals are inserted into the DOM.
- **Terminals page** (`/projects/:id/terminals`) — mission-control grid of live agent panes. Uses `GET /projects/:id/active-runs` for initial data and subscribes to `run.started`, `run.event`, `run.completed` WebSocket events for live updates. Each agent pane shows agent name, status badge, clickable issue link, an event feed with full content display, and elapsed time + cost. Events show their full content: assistant thinking/response text, user messages, tool call details (file paths, commands, patterns), and tool results. The feed auto-scrolls to new events when the user is at the bottom but preserves scroll position when the user has scrolled up to read history. Only agents with active runs are shown — idle agents are hidden. The captain monitor feed was removed from this page; it now lives in the Chat interface. A deprecation notice links to the Chat page.
- **Chat page** (`/projects/:id/chat`) — thread-based chat interface replacing the former PTY-backed Captain terminal. On desktop (≥768px), displays a split-panel layout with a 280px thread list on the left and a chat view on the right. On mobile, the thread list is full-screen; selecting a thread navigates to `/projects/:id/chat/:threadId`. The thread list is rendered by `ChatThreadList.svelte`, which fetches threads via `GET /projects/:id/chat/threads` and supports creating new threads. Monitor threads are pinned at the top with a cyan accent and `[auto]` badge. The page breadcrumb and header label use "Chat" instead of "Captain". The sidebar nav item label was also updated from "Captain" to "Chat". The desktop panel loads thread detail via `GET /projects/:id/chat/threads/:threadId` when a thread is selected and renders `ChatView.svelte` with the loaded thread data.
  - **`ChatView.svelte`** — renders the full chat experience for a thread. Accepts `thread` (`ChatThreadDetail`) and `projectId` props. Renders stored messages with distinct bubble styling per role (system, event, assistant, tool, user), streams assistant responses in real-time via WebSocket (`chat.message`, `chat.tool_call`, `chat.tool_result`, `chat.complete`, `chat.session_expired`), and includes an "Analyzing..." indicator with pulsing cursor while waiting for the first streamed content. Tool call matching uses FIFO order (first unresolved call for the same tool name). The `chat.complete` handler reloads the thread from the API to get canonical stored messages. Uses the `autoscroll` action for auto-scroll behavior and `md()` for assistant message markdown rendering. Tool call content is escaped via `esc()` helpers (`toolLine`, `toolResultLine`) to prevent XSS. Resets all streaming state when the thread prop changes.
  - **`ChatInput.svelte`** — message input bar at the bottom of the chat view. Accepts `disabled` (boolean) and `onSend` (callback) props. Auto-expanding textarea (up to 4 lines) with monospace font. Desktop: Enter to send, Shift+Enter for newline. Mobile: Enter for newline, Send button to send. Disabled during streaming and for monitor threads. Send button uses `bg-cyan` when active, `bg-surface text-muted` when disabled.
  - **`[threadId]/+page.svelte`** — mobile full-screen chat view. Loads thread detail via `GET /projects/:id/chat/threads/:threadId`. Renders `ChatView.svelte` with a sticky header containing a back button and overflow menu. Overflow menu provides: Rename (inline input edit), Delete (confirmation modal, disabled for monitor threads), and New Session (confirmation modal, calls `PATCH` with `session_id: null` then reloads thread). Listens for `chat.session_expired` WebSocket events to reload the thread when the session is transparently reset.
- Issue detail page (`[issueId]/+page.svelte`) is a thin orchestrator (~360 lines) that loads data, manages comment CRUD state, subscribes to WebSocket events, and passes props to focused child components:
  - **`IssueTimeline.svelte`** — renders the unified chronological timeline merging comments, activity entries, and agent run summaries. Accepts `comments`, `activityEntries`, `runs`, and `liveEvents` props. Owns activity expansion state and inline run expansion (loads run events on toggle, appends live events via a reactive `$effect`). Matches `mention.spawned`/`mention.completed` activity entries to `AgentRun` records by `agent_id` + timestamp (60s tolerance) and displays colored status dots (green = running, amber = queued, red = failed, cyan = completed). Stale-fetch guard: captures `runId` before async calls and checks it after await before updating state. Delegates rendering to two sub-components:
    - **`TimelineComment.svelte`** — comment card with author metadata, edit mode form, markdown display, and delete button. Accepts `comment`, `index`, `editingCommentId`, `editingCommentText` (bindable), `commentWorking`, and action callbacks (`onStartEdit`, `onSaveEdit`, `onCancelEdit`, `onDelete`).
    - **`TimelineActivity.svelte`** — activity item with run matching, expandable run details with events list, and activity detail expansion. Accepts `entry`, `index`, `activityExpanded`, `expandedRun`, `expandedEvents`, `loadingEvents`, `matchedRun`, `spawnedRun`, and action callbacks (`onToggleActivityExpand`, `onToggleRunExpand`, `onOpenRunModal`).
  - **`RunDetailModal.svelte`** — modal showing the full event log for a selected run. Accepts a `run` prop and a `liveEvents` map. Loads events from the API on open, merges in any already-received live events, then appends new live events via a second `$effect` that uses `untrack()` to read `modalEvents` without creating a reactive dependency. Stale-fetch guard: captures `runId` before the API call and checks `runId !== run?.id` before assigning results.
  - **`DispatchInput.svelte`** — comment textarea with `/dispatch` autocomplete dropdown. Accepts `onSubmit` callback and `posting` prop. Delegates textarea rendering and autocomplete behavior to `DispatchAutocomplete.svelte`.
  - **`DispatchAutocomplete.svelte`** — shared reusable component encapsulating `/dispatch` autocomplete logic. Reads the `agents` list from Svelte context (`getContext('agents')`). Accepts `value` (bindable), `placeholder`, `rows`, `class`, and `onSubmit` props. Owns all autocomplete state (`showMentions`, `mentionFilter`, `mentionIdx`, `textareaEl`) and keyboard navigation (arrow keys, enter/tab to select, escape to dismiss). Used by both `DispatchInput.svelte` and `IssueComments.svelte`.
- **Issues list page** (`routes/projects/[projectId]/+page.svelte`) is a ~410-line orchestrator that owns data fetching (`fetchEffect`), WebSocket subscriptions, filter/sort state, the `filtered` derived computation, and the dispatch/create handlers. Issues are fetched paginated from the server (default 50, max 100) with a "Load more" button to fetch additional pages. The `total` count from the API enables a "X of Y issues" display. Sorting supports four fields — `created_at`, `updated_at`, `status` (by workflow order via `STATUS_ORDER` from `$lib/config/status.ts`), and `agent` (alphabetically by name). On desktop, clicking a sortable column header toggles the sort; on mobile, a dropdown in the filter bar provides the same options. The default sort is `created_at` descending (newest first). Captain toggle state (`autoStart`, `autoMerge`) is synced from the `project` object via a `$effect` and persisted immediately on toggle via `updateProject()` with a toast confirmation. Column visibility state is managed via `visibleColumns` array (loaded from localStorage via `loadVisibleColumns()` from `$lib/config/columns.ts`, saved on change). The grid layout is computed dynamically using `computeGridCols(visibleColumns)`. It composes three presentational sub-components:
  - **`IssueFilters.svelte`** — filter bar with search input (supports filter syntax: `status:open`, `paused:true`, combined with text search), autocomplete dropdown for filter values (arrow keys, Enter/Tab to select, Escape to dismiss), mobile-only sort controls (field + direction, hidden on desktop via `md:hidden`), captain toggles (Auto-start, Auto-merge), and `ColumnSelector` dropdown. Status and paused filters are parsed from the search query via `parseSearchQuery()` in the page and applied as additional client-side filters on top of the server's default status exclusion (done issues are excluded server-side unless explicitly requested via the `status` query param). All filter props use `$bindable()` for two-way binding from the page. Captain toggles receive `autoStart`/`autoMerge` as plain props and an `onCaptainToggle` callback, visually separated from filters with a left border.
  - **`ColumnSelector.svelte`** — dropdown button labeled "Columns" with checkboxes for each configurable column. Locked columns (title, dispatch) are shown as disabled. Column visibility is bound to parent via `visibleColumns` bindable prop. Dropdown closes on click-outside or Escape key.
  - **`IssueCard.svelte`** — mobile card view for a single issue. Shows title (with pause/proposed indicators), status badge, running agent name, dispatch button, dependencies list, and base branch (conditional). Accepts `issue`, `projectId`, `agentMap`, `visibleColumns`, `project`, `isDispatching`, `ondispatch`, and optional `animationDelay` props. Respects column visibility for agent, base branch, and time columns.
  - **`IssueTableRow.svelte`** — desktop table row for a single issue. Dynamically renders columns based on `visibleColumns` prop. Accepts `issue`, `projectId`, `agentMap`, `visibleColumns`, `gridCols`, `project`, `isDispatching`, `ondispatch`, and `index` props. Each column section is conditionally rendered based on visibility.
  - **Table header row** — sortable column headers (Status, Agent, Age, Updated) are rendered as `<button>` elements with `cursor-pointer`, hover state (`hover:text-primary`), and an active sort indicator (▲/▼) styled with `text-cyan`. Clicking an unsorted column sorts descending; clicking the active column toggles direction. Non-sortable columns (Title, Base, Dispatch) remain plain `<div>` elements.
- **Mission Control terminal** (`ActivityTerminal.svelte`) — fixed-height terminal panel at the bottom of the issues list page displaying real-time activity log. Receives `issues` prop for issue title resolution. Uses `terminal.ts` formatters to convert API activity entries and WebSocket events into `TerminalLine` objects. Each line displays `[timestamp] Issue Title › message` with the issue title rendered as a clickable link to `/projects/:id/issues/:issueId` (truncated at 25 chars with full text in tooltip). Issue title resolution uses 3-tier fallback: API enrichment (`issue_title` field) → WebSocket payload → issues prop lookup. Color-coded by severity: cyan for started events (spawned, run started), green for success, red for errors, amber for warnings and status transitions, gray for info. Uses the `autoscroll` action from `$lib/utils/autoscroll.js` to auto-scroll to bottom as new events arrive (via MutationObserver) when the user is at the bottom; scroll position is preserved when the user has scrolled up. The scroll container captures the `forceScrollToBottom` callback and calls it after the initial activity load to ensure the terminal starts at the bottom. Messages include agent names (e.g., "Engineer spawned", "Engineer finished — success") with human-readable exit code descriptions. Both API-path and WebSocket-path formatters use `agent_name` when available, falling back to `agent_id`. Delegates rendering to two sub-components:
  - **`TerminalHeader.svelte`** — title bar with collapse toggle and agent/error filter buttons. Accepts `title`, `collapsed`, `agentFilter`, `errorFilter`, and toggle callbacks.
  - **`TerminalLine.svelte`** — single terminal line with timestamp, issue title link, message, severity coloring, and new-entry animation. Accepts a `line` prop (`TerminalLine` object).
- Provides autocomplete for `/dispatch` commands in comment inputs via the shared `DispatchAutocomplete.svelte` component (used by `DispatchInput.svelte` and `IssueComments.svelte`).
- Provides "Mark as PR Created" and "Mark as Done" action buttons on issue detail.
- Provides "Reset chain depth" button when chain depth limit is reached.
- **Shared frontend utilities** (`frontend/src/lib/utils/`):
  - `event.ts` — `renderEventContent(event)` formats an `AgentRunEvent` into a human-readable string for display; `extractToolDescription(input)` extracts a short label from a tool input record. Used by `TimelineActivity.svelte`, `RunDetailModal.svelte`, and `AgentRuns.svelte`.
  - `format.ts` — `formatDuration(ms)` converts milliseconds to a `Xs` / `Xm Ys` string; `formatCost(cost)` formats a number as `$X.XXXX`. Used by `TimelineActivity.svelte`, `RunDetailModal.svelte`, and `AgentRuns.svelte`.
  - `comments.ts` — `commentStyle(authorType)` returns border/text color tokens for a comment card; `commentAuthorLabel(comment)` returns the display name for a comment author. Used by `IssueComments.svelte` and `TimelineComment.svelte`.
  - `autoscroll.js` — Svelte action that auto-scrolls a container to the bottom via MutationObserver when new content is added, while preserving scroll position when the user has scrolled up.
- **Column configuration** (`frontend/src/lib/config/columns.ts`): Centralized column metadata and visibility management for the issues list table. Exports `COLUMN_CONFIG` array defining all available columns with `key`, `label`, `width` (Tailwind grid unit), `defaultVisible`, and `locked` flags. Provides utilities: `loadVisibleColumns()` (loads from localStorage with legacy migration from `showBaseBranch` boolean), `saveVisibleColumns()` (persists to `crewdeck:visibleColumns`), `getDefaultVisibleColumns()` (returns default set), and `computeGridCols()` (generates Tailwind `grid-cols-[...]` class from visible columns). Available columns: title (locked), status, agent, baseBranch, age, updated, dispatch (locked).
- **Status configuration** (`frontend/src/lib/config/status.ts`): Centralized status display constants and workflow sort order. Exports `STATUS_ORDER` array defining the canonical workflow progression (Open → In Progress → PR Created → PR Conflict → CI Failed → Ready to Merge → Done) used for sorting the issues list by status column.
- **Shared UI primitives** (`frontend/src/lib/components/ui/`): thin Svelte 5 wrapper components that compose Tailwind classes for consistent styling across the app. All use `$props()` with the `class` prop extracted separately from `...restProps` so consumer-supplied classes merge with (rather than replace) the computed variant classes.
  - `Button.svelte` — `variant` (`primary` | `secondary` | `danger` | `ghost`) × `size` (`xs` | `sm` | `md`). All variants include `disabled:opacity-50` and `transition-colors`.
  - `TextInput.svelte` — wraps `<input>` or `<textarea>` (via `multiline` prop). Props: `type`, `mono` (adds `font-mono`), `compact` (tighter padding), `multiline`. `value` is `$bindable`.
  - `Select.svelte` — `variant` (`form` for full-width form fields | `filter` for compact inline selects). Accepts `children` snippet for `<option>` elements.
- **Error handling convention**: User-facing errors from user-initiated actions (page load, form submit, status change) are shown via `toastStore.add(message, 'error')`. WS-triggered background refreshes and polling use silent `.catch(() => {})` to avoid flooding the user with transient network errors.

**Backend (Node.js + TypeScript)**

- Exposes REST API (versioned at `/api/v1`) for CRUD operations on projects, issues, comments; crew is read-only (fixed constants).
- Admin authentication via session cookies or API keys (Bearer token). Session cookies use bcrypt password hashing, HTTP-only cookies, rate-limited login. API keys use SHA-256 hashed storage; a system key is auto-generated on startup and injected into agent/captain processes. Key management endpoints are session-auth-only (API keys cannot manage other API keys).
- All request validation via Zod schemas. Issue and PR status fields use Zod enum validation against centralized constants (`backend/src/constants/statuses.ts`).
- Centralized error handling middleware (all errors formatted as `{ error: { code, message, details } }`).
- Runs WebSocket server (`ws` library) to push real-time events to the frontend. Supports two connection modes: per-project (`/ws?projectId={id}`) and global (`/ws?global=true` for dashboard). Connections require a valid session cookie — validated via `validateSessionFromCookie()` before accepting.
- Runs separate terminal WebSocket server (`/terminal-ws`) for PTY streaming. Session validation is enforced on this endpoint as well (the most sensitive endpoint — direct shell access).
- In-process event bus (typed EventEmitter) for decoupled internal communication between components.
- Manages agent lifecycle — spawning `claude -p` processes, tracking active processes, enforcing global concurrency limits.
- Manages terminal sessions — persistent tmux sessions running Claude CLI with idle timeout cleanup (default 30 min, `ORCHESTRATION_PTY_IDLE_TIMEOUT_MS`).
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
- Enforces per-process timeout (default 10 min, `ORCHESTRATION_DEFAULT_AGENT_TIMEOUT_MINUTES`).

**PR Detector**

- Subscribes to `comment.added` events.
- Parses PR URLs from comment text using registered VCS provider clients (currently GitHub only).
- Matches URLs against repos linked to the project.
- Creates `IssuePR` records for new PRs (deduped by repo + PR number).
- Emits `pr.created` for each newly linked PR.

**PR Poller**

- Runs on a configurable interval (default 60 s, `ORCHESTRATION_PR_POLL_INTERVAL_MS`). Started at startup, stopped on shutdown.
- Queries all open `IssuePR` records with their project/repo context.
- Fetches current PR state from the VCS provider (currently GitHub only) using the project's OAuth token.
- Updates `IssuePR.status` when a PR is merged or closed.
- Auto-transitions the linked issue to `done` when a PR is merged (regardless of current status, unless already `done`).
- For open PRs, also checks:
  - **Merge conflicts** — via the `mergeable` field. If `false`, transitions issue to `pr_conflict`.
  - **CI status** — checks all configured CI systems. If any check failed, transitions issue to `pr_failed_actions`. If all checks pass and mergeable, transitions to `pr_ready_to_merge`.
- Issues in intermediate states (`pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`) are transitioned back to `pr_created` when conditions become pending (e.g., new commits pushed).
- **Only processes issues in PR-related statuses** (`pr_created`, `pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`). Issues in `in_progress` are skipped. When an agent is dispatched to fix a conflict or CI failure, the spawner regresses the issue to `in_progress` — the captain monitor restores it back to `pr_created` after the agent completes, so the poller picks it up again.
- Emits `pr.status_changed` and `issue.status_changed` events accordingly.
- Exports `pollPRs()` for external callers to trigger immediate polling.

**Event Commenter**

- Deterministic event-to-comment bridge that posts system comments when system events occur.
- Subscribes to: `run.completed`, `pr.status_changed`, `issue.status_changed`.
- Posts formatted system comments on the relevant issue (e.g., "✅ **engineer** completed (exit code 0). Cost: $0.12. Duration: 45s.").
- Events are automatically converted to plain comments that any agent can read.
- See `backend/src/events/event-commenter.ts`.

**VCS Provider Abstraction**

- All VCS-specific operations (GitHub, GitLab, etc.) are abstracted behind a `VCSProviderClient` interface (`backend/src/vcs/types.ts`).
- GitHub implementation in `backend/src/vcs/github/client.ts` handles URL parsing, repo metadata, PR operations, and CI status checks.
- Provider registry (`backend/src/vcs/registry.ts`) allows registration of multiple VCS providers and URL-based provider detection.
- Ready for multi-VCS support — adding GitLab or Bitbucket requires only implementing the interface.

**Captain**

Captain is a dispatchable agent invoked via `/dispatch captain` in issue comments. When invoked, Captain reads the issue context and all comments to understand project state, then outputs orchestration commands.

**Commands**:

- `/dispatch <agent>` — Dispatch an agent to work on the current issue
- `/merge <issue_id>` — Merge a PR for an issue (only works on `pr_ready_to_merge` status)
- `/create-pr <issue_id>` — Create a PR for an issue (after engineer has pushed code)
- `/create-issue <title>` — Create a new issue

**Captain Monitor Modules** (`backend/src/orchestration/captain/`)

The captain monitor is split into focused modules:

| Module                     | Responsibility                                                        |
| -------------------------- | --------------------------------------------------------------------- |
| `monitor-agent.ts`         | Orchestrator — calls the other modules, spawns LLM, executes plan; dual-writes events/responses to the project's monitor chat thread and emits `chat.*` WebSocket events alongside `monitor.*` events |
| `prompt-builder.ts`        | Builds the system prompt (project config + state snapshot + capacity) |
| `state-snapshot.ts`        | Queries DB for issues, runs, knowledge; returns formatted markdown    |
| `event-formatter.ts`       | Formats raw events with enriched DB context (PR info, agent reports)  |
| `monitor-history.ts`       | Retrieves the last 10 monitor conversation turns from DB              |
| `action-plan-extractor.ts` | Parses action plan JSON from stream events or result text             |

**Captain Context** (`backend/src/orchestration/prompt.ts`)

When spawning Captain, the backend injects project-specific context:

- `max_concurrency` — maximum concurrent agents
- `runningAgents` — list of currently running agents with issue IDs and titles
- `queuedAgents` — list of queued agents waiting for capacity
- `allIssues` — all issues with their status and PR status

This context enables Captain to make informed orchestration decisions based on current project state.

**Captain Monitor State Snapshot** (`backend/src/orchestration/captain/state-snapshot.ts`)

The captain monitor builds a state snapshot for each LLM call via `buildStateSnapshot()`. For each non-closed issue the snapshot includes the issue ID, status, paused flag, manual approval flags (`(approved-to-start)`, `(approved-to-merge)`), running agent (if any), title, and — if the issue has an open PR — the PR number and URL in the format `[PR: #<number> <url>]`. This lets the captain see which `in_progress` issues already have open PRs, even when the issue was regressed from a PR-related status.

**Manual Approval System** (`backend/src/orchestration/approval-store.ts`)

When `auto_start` and `auto_merge` project settings are OFF, users can manually approve specific issues for work or merge using the UI:

- **Play button** adds the issue ID to `approvedToStart` Set and emits `issue.approved_to_start` event
- **Merge button** adds the issue ID to `approvedToMerge` Set and emits `issue.approved_to_merge` event

Captain's decision logic:

- `canStart = approvedToStart.has(issueId) || project.auto_start`
- `canMerge = approvedToMerge.has(issueId) || project.auto_merge`

Approval flags are cleared after successful dispatch/merge and are stored in-memory (cleared on server restart).

**Captain Monitor Event Response Rules**

When the captain monitor handles a `run.completed` event: if the completed issue has an open PR (visible in the snapshot or event context), the captain sets the issue status back to `pr_created`. This ensures the PR poller re-evaluates CI and mergeability from GitHub, since the poller skips `in_progress` issues.

The captain continues the workflow up to PR creation (engineer → lead → docs → PR). After a PR is created or updated, the captain sets status to `pr_created` and **waits** — it does NOT issue a merge action immediately. The PR poller transitions the issue to `pr_ready_to_merge` once CI passes. The captain only merges after receiving a `status_changed → pr_ready_to_merge` event.

**Command Execution** (`backend/src/orchestration/command-handlers.ts`)

Captain's output commands are parsed by the mention handler and executed via command-handlers.ts:

- `handleDispatchAgent()` — spawns the specified agent on the issue
- `handleMergePR()` — merges the PR using the VCS provider; rejects with an error if the issue is paused or `issue.status !== 'pr_ready_to_merge'`, making it impossible to merge before CI passes or while paused regardless of LLM decisions
- `handleCreatePR()` — creates a PR using the VCS provider; rejects with an error if the issue is paused
- `handleCreateIssue()` — creates a new issue

Commands are restricted to captain-only (checked via `author_type === "captain"` in handler.ts).

Truncated issue IDs (8+ character prefixes shorter than a full UUID) are resolved to full UUIDs before execution via `resolveIssueId()` in `backend/src/orchestration/issue-resolver.ts`. This utility is shared by both `command-handlers.ts` and `captain/plan-executor.ts`.

**PTY Service** (`backend/src/orchestration/pty-service.ts`, `captain-prompt.ts`, `captain-worktree.ts`)

The terminal/PTY functionality is split across three focused modules:

- **`pty-service.ts`** — session lifecycle manager. Manages persistent tmux sessions running Claude CLI for terminal access to captain chat. Each project can have one terminal session running `claude --system-prompt-file` inside tmux. Session lifecycle: `createTerminalSession()`, `getTerminalSession()`, `destroyTerminalSession()`. Auto-cleanup: idle timeout kills sessions and removes temporary files (system prompt, SSH keys) — default 30 min, `ORCHESTRATION_PTY_IDLE_TIMEOUT_MS`. Concurrency control: `pendingCreations` Set guards against race conditions when multiple clients request sessions simultaneously.
- **`captain-prompt.ts`** — system prompt builder. `buildSystemPrompt()` constructs the enriched system prompt injected into each session: project knowledge (workflows/conventions), API reference (Issues, Runs, Activity, Knowledge APIs), current capacity (running agents, available slots), project settings, and repository context.
- **`captain-worktree.ts`** — worktree and auth setup. `createCaptainWorktree()` creates or reuses a long-lived git worktree per project (named `captain/<project-slug>`) in `/tmp/crewdeck/<project-slug>/captain`. The worktree persists across PTY reconnects and auto-rebases onto the latest default branch on creation. Terminal sessions run with the worktree as the working directory. `setupGitHubAuth()` configures `GH_TOKEN` and `GIT_SSH_COMMAND` from the project's VCS account.

Environment injection: project-defined env vars (from project settings), `CREWDECK_*` vars, `GH_TOKEN`, `GIT_SSH_COMMAND` from the project's GitHub account, provider-specific env vars (via `buildProviderEnv(model)`), and `ANTHROPIC_API_KEY=""` to clear any inherited key (matching agent spawn behavior in `process.ts`). These are baked directly into the tmux `new-session` command as `env KEY=VAL ... claude --model <model> ...` so the shell inside the session receives them regardless of tmux server environment state.

**Terminal WebSocket Server** (`backend/src/terminal-ws.ts`)

- Separate WebSocket server on `/terminal-ws?projectId={id}` path.
- **Session validation**: connections are authenticated via `validateSessionFromCookie()` from `middleware/auth.ts`. Invalid/missing sessions are rejected with `ws.close(4001, 'Unauthorized')` before any other processing.
- Spawns `node-pty` process attaching to the project's tmux session via `tmux attach-session -t {name}`.
- Bidirectional I/O: PTY output → WebSocket send (raw bytes), WebSocket messages → PTY write (keyboard input).
- Resize handling: JSON messages with `{ type: "resize", cols, rows }` → `pty.resize()`.
- Connection cleanup: kills PTY attach process on disconnect (does not kill the tmux session itself).

**Chat Service** (`backend/src/orchestration/chat-service.ts`)

Handles Claude session lifecycle for the web-based chat interface. Each chat thread spawns `claude -p` with `--resume {sessionId}` for persistent multi-turn conversations.

- **Session management**: Captures Claude CLI session IDs from `system` stream events and stores them on the `ChatThread` record. Subsequent messages reuse the session via `--resume`.
- **Session expiry recovery**: If `--resume` fails (expired/invalid session), the service emits `chat.session_expired`, clears the stored session ID, and starts a fresh session transparently.
- **Concurrency control**: An in-memory lock (Map<threadId, boolean>) ensures only one `claude -p` process runs per thread at a time. Concurrent sends return `409 CONFLICT`.
- **Event streaming**: Emits `chat.message`, `chat.tool_call`, `chat.tool_result`, `chat.complete`, and `chat.session_expired` events on the event bus with `project_id` and `thread_id` for frontend filtering. The monitor agent also dual-writes to the project's monitor chat thread — events save as `role: 'event'`, assistant responses as `role: 'assistant'` — and emits `chat.*` equivalents of `monitor.*` events (`chat.event_received`, `chat.thinking`, `chat.message`, `chat.tool_call`, `chat.tool_result`, `chat.complete`) so the Chat UI receives real-time monitor activity without needing to subscribe to `monitor.*` events.
- **System prompts**: Uses the captain prompt builder (`captain-prompt.ts`) for monitor threads; a simpler prompt with project context (knowledge, repo info) for user threads.
- **Environment**: Same pattern as monitor agent — sets `CREWDECK_API_URL`, `CREWDECK_PROJECT_ID`, GitHub auth, provider API keys, etc.

**Event Bus**

- In-process typed EventEmitter singleton.
- All internal components communicate through the event bus rather than calling each other directly.
- Producers: REST API handlers, MentionHandler, Chat Service, PR Detector, PR Poller, VCS Provider clients.
- Consumers: MentionHandler, PR Detector, WebSocket broadcaster, Activity Logger, Event Commenter, Worktree Cleanup.
- Fire-and-forget — emitters do not wait for consumers to finish processing.

**SQLite Database**

- Stores all persistent state: projects, issues, comments, activity logs, admin users, sessions, API keys. (Agents are fixed constants in code, not persisted.)
- Accessed via `better-sqlite3` with raw SQL (synchronous API).
- File-based migration system in `backend/src/db/migrations/`. Migrations are the single source of truth — there is no separate `schema.sql`. Fresh databases run all migrations from `000_initial_schema.sql` to the latest.
- Versioned migration system (`_migrations` table) tracks which migrations have run. Each migration runs idempotently — it checks whether its changes are already present before executing, making it safe for both fresh and existing databases. Destructive migrations (table recreation) are wrapped in transactions with `foreign_keys = OFF`.
- Standalone migration commands: `npm run migrate` (run migrations) and `npm run migrate:create -- description` (scaffold new migration).
- Single file, no external dependencies, suitable for local-first operation.
- Repository layer shared utilities (`backend/src/db/repositories/utils.ts`): `buildAndRunUpdate()` for generic UPDATE queries, `deserializeBoolean()` for SQLite 0/1 → JS boolean conversion, `deserializeJson()` for JSON string → object conversion.
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
│  ├── REST API handlers    ──→  WebSocket broadcaster     │
│  ├── Agent Runtime        ──→  Global WS broadcaster     │
│  ├── MentionHandler       ──→  MentionHandler            │
│  ├── Chat Service         ──→  Activity Logger           │
│  ├── PR Detector/Poller   ──→  PR Detector               │
│  │                        ──→  Event Commenter            │
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
8. Event Commenter receives event → (no action for comment.added)
9. API handler returns 201 to the client
```

### Example Flow: Issue Reaches Done Status

```
1. REST API: PATCH /api/v1/projects/:id/issues/:issueId (status: "done")
2. API handler updates issue status in DB
3. API handler emits: bus.emit("issue.status_changed", { issue_id, project_id, from: "in_progress", to: "done" })
4. Event Commenter receives event → posts system comment with status transition
5. Worktree Cleanup listener receives event → cleans up git worktree, always clears DB fields (in finally block)
6. Activity Logger receives event → writes ActivityLog entry
7. WebSocket broadcaster receives event → sends to connected frontend clients
8. API handler returns 200 to the client
```

## Real-Time Communication

All state changes are broadcast to connected frontend clients via WebSocket:

- **Issue events** — created, status changed, comment added, comment updated, comment deleted.
- **Agent events** — mention spawned, mention completed, chain depth reached, dispatch queued, dispatch dequeued. The Terminals page subscribes to `run.started`, `run.event`, and `run.completed` for live agent activity feeds.
- **PR events** — PR created, status updated.
- **Chat events** — assistant message chunks, tool calls, tool results, completion, session expiry, event_received, thinking. Emitted by the Chat Service during `claude -p` sessions for chat threads, and dual-emitted by the monitor agent (as `chat.*` equivalents of `monitor.*` events) so the Chat UI receives real-time monitor activity.

The frontend subscribes to events scoped by project. All event payloads are strongly typed via a `WsEventMap` interface (`frontend/src/lib/api/types.ts`) that maps each event name to its payload type. `ProjectWebSocket.on()` uses generic overloads so handlers receive typed `data` parameters with full IDE autocomplete.

### Global WebSocket (Dashboard)

A separate global WebSocket connection (`/ws?global=true`) broadcasts all events (except high-frequency `run.event` and monitor events) to dashboard subscribers. This allows the dashboard to update project stats and the activity feed in real-time without per-project connections or polling. The `GlobalWebSocket` class (`frontend/src/lib/api/global-ws.svelte.ts`) mirrors `ProjectWebSocket` with the same reconnection logic and a reactive `state` property. Event payloads are typed via `GlobalWsEventMap` — a subset of `WsEventMap` that excludes `run.event` and monitor events.

### Shared Frontend Utilities

**`$lib/utils/ws-subscriptions.ts`** — `useWsSubscriptions(ws, subscriptions)`

Subscribes to multiple WebSocket events in one call and returns a single cleanup function. Designed to be used inside a Svelte `$effect`:

```ts
$effect(() => {
  return useWsSubscriptions(ws, {
    "issue.created": (data) => { ... },
    "run.started": (data) => { ... },
  });
});
```

Takes a `ProjectWebSocket` and a `SubscriptionMap` (a partial `Record<WsEvent, handler>` where each handler is typed to its event's payload via `WsEventMap`). Subscribes all handlers and returns a cleanup function that unsubscribes all of them. Used by `QueueMonitor.svelte`, `AgentRuns.svelte`, `ActivityTerminal.svelte`, `routes/projects/[projectId]/+page.svelte`, and `routes/projects/[projectId]/terminals/+page.svelte`.

> **Note:** Components that need to subscribe the same event twice with different handlers (e.g., `issues/[issueId]/+page.svelte`) continue to use an array of unsubscribe functions directly, since a `Record`-based map cannot express duplicate keys. The dashboard uses `GlobalWebSocket` (not `ProjectWebSocket`) with direct `on()` calls for stats and activity event subscriptions.

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
4. Chain depth checked (atomic DB increment, global max_chain_depth)
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
10. Process runs (timeout: `ORCHESTRATION_DEFAULT_AGENT_TIMEOUT_MINUTES`, default 10 min)
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

- A single global concurrency limit (`max_concurrency` setting, default 5): maximum agents running across all projects.
- The MentionHandler checks this limit before each spawn.
- If the limit is reached, the dispatch is placed in a DB-backed FIFO queue (using `AgentRun` table with `status='queued'`) and a system comment is posted with the queue position. When a running process exits, the handler dequeues the next pending dispatch and spawns it automatically. Queued runs persist across server restarts.

## Process Lifecycle

### Startup

On startup, the backend:

1. Loads configuration from environment variables (`.env` file).
2. Initializes SQLite database (runs all pending migrations from `backend/src/db/migrations/`).
3. Ensures a system API key exists (deletes and recreates on every startup, storing the raw key in memory for agent/captain injection).
4. Initializes the activity logger (registers event listeners).
5. Initializes the worktree cleanup listener (subscribes to `issue.status_changed`).
6. Initializes the event commenter (subscribes to `run.completed`, `pr.status_changed`, `issue.status_changed`).
7. Initializes the MentionHandler (subscribes to `comment.added`).
8. Initializes the PR detector (subscribes to `comment.added` for auto-linking PRs).
9. Starts the PR poller (polls VCS providers for PR status updates, default every 60 s, `ORCHESTRATION_PR_POLL_INTERVAL_MS`).
10. Starts the Express HTTP server.
11. Starts the WebSocket server (`/ws` for events).
12. Starts the terminal WebSocket server (`/terminal-ws` for PTY streaming).
13. Logs startup complete via pino.

Note: any agent processes spawned before a crash are lost on restart (no in-memory state recovery). Terminal sessions are also lost (clients must reconnect and recreate sessions).

### Graceful Shutdown

On SIGTERM or SIGINT, the backend:

1. Stops accepting new HTTP connections.
2. Sends SIGTERM to all active agent processes (via `shutdownMentionHandler()`).
3. Stops the PR poller.
4. Closes the SQLite database connection.
5. Exits the process.

## Security and Access

- **Admin authentication**: The backend requires either a session cookie or an API key for all API endpoints (except health check and initial setup). A single admin account is created via `POST /api/v1/auth/setup`. Sessions use `HttpOnly; Secure; SameSite=Strict` cookies with a 10-year `maxAge` (sessions persist indefinitely; no server-side expiry check). Multiple concurrent sessions are supported — logging in from a new device does not invalidate existing sessions, and logout only affects the calling device. Passwords are hashed with bcrypt (≥ 12 rounds). Login is rate-limited to 5 attempts per minute per IP.
- **API key authentication**: API keys provide programmatic access. The auth middleware checks for `Authorization: Bearer <key>` first, then falls back to session cookies. Keys are stored as SHA-256 hashes; the plaintext is shown only once at creation. A system API key is auto-generated on every server startup for internal agent/captain use — it is passed as `CREWDECK_API_KEY` to all spawned processes. Key management endpoints (`/api-keys`) require session auth to prevent API keys from managing other API keys. System keys are hidden from the user-facing UI.
- **Frontend auth middleware**: `hooks.server.js` validates the session cookie on every non-auth request by calling `GET /api/v1/auth/me`. Invalid/missing sessions redirect to `/login`. If no admin exists (`needsSetup: true`), redirects to `/register`. Auth paths (`/login`, `/register`, `/api/v1/auth/*`) are exempt. Static assets (files with extensions) are also exempt.
- **Auth layout**: The root layout (`+layout.svelte`) conditionally renders — auth pages (`/login`, `/register`) get a centered layout without the sidebar; all other pages render the normal sidebar layout with utility navigation (Accounts, API Keys, Settings grouped under a collapsible SYSTEM section) and a logout button at the bottom.
- **First-login onboarding**: When a user first logs in and has not yet created a project (`setupCompleted` is `false`), the dashboard auto-opens the Create Project modal. Creating a project marks `setupCompleted = true` in the database. Subsequent logins show the dashboard normally.
- GitHub authentication is managed in-app via Device Flow OAuth (Accounts page). No host-level `gh auth login` is required.
- OAuth tokens are stored in SQLite and injected as `GH_TOKEN` into agent processes at spawn time. They are never persisted in `.git/config`.
- Each project can be linked to a specific GitHub account, enabling per-project identity for git operations.
- Full audit trail of all agent actions is maintained in the database.

## Future Considerations

- **Additional CLI tool adapters** — support for tools other than Claude Code.
- **Remote execution** — running agents on remote servers instead of local processes.
- **Multi-user support** — multiple humans overseeing the same project.
- **Integration with external trackers** — syncing issues with GitHub Issues, Linear, or Jira.
