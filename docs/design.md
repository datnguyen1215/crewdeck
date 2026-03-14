---
title: CrewDeck Design Document
version: 0.2.0
status: draft
---

# CrewDeck — Design Document

## Problem Statement

Software development teams increasingly want to leverage AI coding agents for autonomous task execution. However, managing multiple AI agents working simultaneously on a codebase presents several challenges:

- **No unified coordination** — agents operate in isolation with no awareness of each other's work.
- **No review pipeline** — AI-generated code goes unreviewed or requires manual human review for every change.
- **No audit trail** — there is no record of why an agent made specific decisions or what feedback it received.
- **No prioritization** — issues must be manually triaged and assigned, with no intelligent routing based on agent expertise.
- **Vendor lock-in** — systems built around a specific AI tool cannot easily adopt alternatives.

CrewDeck solves these problems by providing a local-first issue management platform where crews of AI agents autonomously work on issues, review each other's code, and prepare pull requests — all under human oversight.

## Core Concepts

### Project

A project represents a body of work tied to one or more GitHub repositories. Each project has:

- A name and description.
- One or more linked GitHub repositories.
- A single orchestrator (persistent AI session).
- A crew of agents.
- Configuration for concurrency limits and max review rounds.

### Crew

A crew is a team of agents belonging to a project. Crews are assembled based on the needs of the project. For example, a crew might consist of two senior software engineers and one security expert.

### Agent

An agent is a specialized AI persona defined by a custom system prompt. Agents have:

- A name and role description (e.g., "Senior Software Engineer", "Security Expert").
- A system prompt generated and refined through AI assistance (using the CLI tool).
- Expertise areas that the orchestrator uses for task assignment.

Agent creation is AI-assisted: the user describes the role they want, and the system uses the CLI tool to generate and refine a detailed system prompt for that agent.

### Orchestrator

The orchestrator is a persistent AI session scoped to a single project. It is the brain of the system. The orchestrator:

- **Prioritizes issues** — analyzes all open issues and determines execution order based on content, dependencies, and urgency.
- **Assigns agents** — matches issues to the best-fit agent based on expertise and availability.
- **Manages the review pipeline** — routes completed work to reviewers in the appropriate order, tracks review rounds, and handles feedback loops.
- **Creates draft issues** — can propose new issues (e.g., breaking a large issue into sub-tasks, identifying related problems). All orchestrator-created issues start in Draft status and require human approval.
- **Manages dependencies** — understands which issues depend on others and sequences work accordingly, including basing worktrees on previous branches when needed.

The orchestrator does not run continuously. It has a persistent session ID stored in the database. The backend resumes the orchestrator's session when events occur (new issue approved, agent finished work, review posted). This approach is resource-efficient and maintains full context across invocations.

### Issue

An issue is the fundamental unit of work. Issues have:

- A title and description.
- A status reflecting its position in the lifecycle.
- An assigned agent (set by the orchestrator).
- A comment thread where agents and humans post updates, findings, and review feedback.
- Linked branch/worktree information (recorded when an agent begins work).
- Linked pull requests (created manually via the frontend when ready).
- An activity log recording every state change and action.
- A configurable max review rounds (overrides project default if set).

### Comment

Comments are the communication layer. Agents post comments on issues to:

- Report progress and decisions during implementation.
- Provide review feedback (code quality, refactoring suggestions, security findings).
- Respond to feedback from other agents.
- The orchestrator posts comments for coordination (assignment notifications, status changes).

Humans can also post comments to provide direction or additional context.

### Pull Request

A pull request is created manually by the user via a button in the frontend. Before PR creation, the system tracks:

- The branch name and worktree path where work was done.
- The target repository.
- The linked issue.

After the user clicks the create button, the system uses `gh` CLI to create the PR on GitHub and records the PR URL and status back on the issue.

## Issue Lifecycle

```
Draft → Open → In Progress → In Review ⟲ → Ready → PR Created → Done
                                  ↑
                                  │ (loop until all
                                  │  reviewers approve
                                  │  or max rounds hit)
                                  ↓
                              Feedback
```

### States

| State | Description |
|-------|-------------|
| **Draft** | Issue created by the orchestrator. Awaiting human approval. |
| **Open** | Approved and in the queue. Orchestrator will prioritize and assign. |
| **In Progress** | An agent is actively working on the issue in a tmux session. |
| **In Review** | Work is complete. Reviewers are examining the code. |
| **Feedback** | Reviewers have posted feedback. Original agent needs to address it. |
| **Ready** | All reviewers have approved. Waiting for human to create PR. |
| **PR Created** | Pull request has been created on GitHub. |
| **Done** | PR merged or issue otherwise resolved. |

### Review Loop

1. The assigned agent completes work and records branch/worktree info on the issue.
2. The orchestrator routes the issue to the first reviewer.
3. The reviewer examines the code in their own tmux session, posts comments.
4. If changes are requested, the issue moves to Feedback, and the original agent addresses the feedback.
5. Steps 2-4 repeat for each reviewer (e.g., code quality reviewer, then security reviewer).
6. This loop continues until all reviewers approve or the configurable max rounds are reached.
7. If max rounds are reached, the issue escalates to the human for a decision.

## Technology Decisions

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Backend language** | TypeScript | Type safety, shared types with frontend |
| **HTTP framework** | Express | Widely adopted, mature ecosystem |
| **Database** | SQLite via `better-sqlite3` | Synchronous API (performance advantage for SQLite), no async overhead, raw SQL for full control |
| **Request validation** | Zod | Strict schema validation, self-documenting, TypeScript integration |
| **WebSocket** | `ws` | Minimal, no abstraction overhead |
| **Testing** | Vitest | Fast, native TypeScript support, compatible with Vite ecosystem |
| **Logging** | pino | Fast structured JSON logging |
| **Frontend framework** | SvelteKit (Svelte 5 with runes) | Fine-grained reactivity, minimal boilerplate |
| **CSS** | Tailwind CSS | Utility-first, dark theme, no component library |
| **Configuration** | Environment variables (`.env`) | Simple, standard approach |
| **Orchestrator responses** | Structured JSON | Reliable parsing, deterministic action extraction |

## Project Structure

```
crewdeck/
├── frontend/          # SvelteKit application
├── backend/           # Express + TypeScript API server
├── cli/               # CrewDeck CLI (agent ↔ backend communication)
├── docker-compose.yml # Docker Compose for containerized deployment
└── docs/              # Design documentation
```

The frontend and backend are separate directories (not a monorepo with workspaces). Each has its own `package.json` and runs independently.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Frontend (Svelte)               │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Project  │ │  Issue   │ │  Live Terminal   │ │
│  │Dashboard │ │  Board   │ │  View (xterm.js) │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Crew    │ │ Activity │ │  Notifications   │ │
│  │ Manager  │ │   Log    │ │                  │ │
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
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Session  │ │  Agent   │ │   Orchestrator   │ │
│  │ Manager  │ │ Runtime  │ │    Manager       │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
│  ┌──────────────────────────────────────────────┐ │
│  │  Centralized Error Handler + Zod Validation  │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────┘
                     │
          ┌──────────┼──────────┬──────────┐
          ▼          ▼          ▼          ▼
     ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
     │ SQLite │ │  tmux  │ │   gh   │ │crewdeck│
     │   DB   │ │Sessions│ │  CLI   │ │  CLI   │
     └────────┘ └────────┘ └────────┘ └────────┘
                                           ↑
                                           │ HTTP calls
                                           │ to backend
                                      ┌────────────┐
                                      │ AI Agents  │
                                      │ (in tmux)  │
                                      └────────────┘
```

### Component Responsibilities

**Frontend (Svelte)**
- Renders project dashboard, issue board, crew management, activity log.
- Connects to backend via WebSocket for real-time updates (comments, status changes, agent activity).
- Embeds xterm.js for live terminal views of agent tmux sessions.
- Provides approval buttons for draft issues and PR creation.

**Backend (Node.js + TypeScript)**
- Exposes REST API (versioned at `/api/v1`) for CRUD operations on projects, crews, agents, issues, comments.
- All request validation via Zod schemas.
- Centralized error handling middleware (all errors formatted as `{ error: { code, message, details } }`).
- Runs WebSocket server (`ws` library) to push real-time events to the frontend.
- In-process event bus (typed EventEmitter) for decoupled internal communication between components.
- Handles events (issue approved, agent finished, review posted) by resuming the orchestrator session.
- Manages agent lifecycle — spawning tmux sessions, tracking output, cleaning up.
- Graceful shutdown on SIGTERM/SIGINT — saves session state, cleans up tmux sessions.
- On startup, automatically detects and cleans up orphaned tmux sessions from previous crashes.
- Structured JSON logging via pino.
- CORS enabled for local frontend development.

**Session Manager**
- Tracks all AI session context in SQLite (conversation history, decisions, state).
- When resuming a session, constructs a focused prompt with current relevant state from the database rather than relying on the CLI tool's built-in session management.
- This makes the system CLI-tool-agnostic — context is owned by CrewDeck, not the underlying tool.

**Agent Runtime**
- Abstraction layer over the CLI tool (Claude Code as default, swappable).
- Manages tmux sessions — spawning, sending messages, capturing output.
- Provides a uniform interface so the backend doesn't care which CLI tool is running.
- See [Agent Runtime](agent-runtime.md) for the full specification.

**CrewDeck CLI (`cli/`)**
- Lightweight CLI tool that AI agents call from within their tmux sessions to communicate back to the backend.
- Makes HTTP calls to internal backend API endpoints.
- Enables agents to report status, post comments, signal completion, and more.
- Agents are instructed to use this CLI via their system prompt; documentation is kept in a separate file (see [Agent CLI](agent-cli.md)) and referenced from the project's CLAUDE.md.
- See [Agent CLI](agent-cli.md) for the full specification.

**Event Bus**
- In-process typed EventEmitter singleton.
- All internal components communicate through the event bus rather than direct coupling.
- Producers: REST API handlers, Agent Runtime, Orchestrator Manager, Session Manager, CrewDeck CLI endpoints.
- Consumers: Orchestrator Manager, WebSocket broadcaster, Session Manager, Activity Logger.
- Fire-and-forget — emitters do not wait for consumers to finish processing.

**SQLite Database**
- Stores all persistent state: projects, crews, agents, issues, comments, activity logs, session context.
- Accessed via `better-sqlite3` with raw SQL (synchronous API).
- Single `schema.sql` file executed on startup for migrations.
- Single file, no external dependencies, suitable for local-first operation.
- See [Data Model](data-model.md) for the full schema.

## Event Bus

The backend uses an in-process typed EventEmitter as the central communication backbone. All internal components communicate through the event bus rather than calling each other directly. This decouples producers from consumers and makes the system easier to extend.

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
│  ├── CrewDeck CLI (HTTP)  ──→  Session Manager           │
│  ├── Orchestrator Manager ──→  Activity Logger           │
│  └── Session Manager                                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Behavior

- **Fire-and-forget** — producers emit events and move on. Consumers handle errors independently.
- Events are processed synchronously within the Node.js event loop.
- Every event bus event maps to a corresponding WebSocket event for frontend notification.

### Example Flow: User Creates an Issue

```
1. REST API: POST /api/v1/projects/:id/issues
2. API handler creates issue in DB
3. API handler emits: bus.emit("issue.created", { issue })
4. Activity Logger receives event → writes ActivityLog entry
5. WebSocket broadcaster receives event → sends to connected frontend clients
6. Orchestrator Manager receives event → resumes orchestrator to evaluate the new issue
7. API handler returns 201 to the client
```

## Real-Time Communication

All state changes are broadcast to connected frontend clients via WebSocket:

- **Issue events** — created, status changed, assigned, comment added.
- **Agent events** — session started, session ended, output streaming.
- **Orchestrator events** — issue prioritized, agent assigned, draft issue proposed.
- **PR events** — PR created, status updated.

The frontend subscribes to events scoped by project. This ensures the dashboard always reflects the current state without polling.

## Execution Model

### Tmux Session Management

Each active piece of work gets its own tmux session:

- **One session per agent per issue** — when an agent is assigned to work on an issue, a new tmux session is created.
- **Reviewers get separate sessions** — each reviewer examining an issue gets their own tmux session.
- **Sessions are ephemeral** — created when work starts, cleaned up when work completes.
- **Session output is captured** — the backend streams tmux output for the xterm.js live view and stores relevant portions in the database.

### Git Worktree Isolation

Each agent works in an isolated git worktree:

- When an agent starts work on an issue, a new worktree is created from the appropriate base branch.
- The orchestrator determines the base branch — it could be `main`, or it could be another issue's branch if there's a dependency.
- The worktree path and branch name are recorded on the issue.
- Reviewers access the same worktree to examine the code.

### Concurrency Control

- Each project has a configurable concurrency limit (how many issues can be worked on simultaneously).
- The orchestrator respects this limit when assigning work.
- Issues beyond the limit are queued and assigned as slots become available.
- The orchestrator determines queue priority based on issue analysis.

## Process Lifecycle

### Startup

On startup, the backend:

1. Loads configuration from environment variables (`.env` file).
2. Initializes SQLite database (runs `schema.sql` if tables don't exist).
3. Scans for orphaned tmux sessions from previous crashes (sessions prefixed with `crewdeck-`).
4. Cleans up orphaned sessions: kills tmux sessions, updates Session records to `error` status.
5. Starts the Express HTTP server.
6. Starts the WebSocket server.
7. Logs startup complete via pino.

### Graceful Shutdown

On SIGTERM or SIGINT, the backend:

1. Stops accepting new HTTP connections.
2. Saves session state for all active agent sessions (captures tmux output, updates Session.context in DB).
3. Kills all active tmux sessions gracefully (sends exit command, then force-kills after timeout).
4. Updates all active Session records to `completed` or `error` status.
5. Closes the SQLite database connection.
6. Exits the process.

## Security and Access

- Agents use the host machine's existing `gh` CLI authentication.
- All PRs are created under the authenticated user's GitHub account.
- The system runs locally — no data leaves the machine except through GitHub API calls.
- Full audit trail of all agent actions is maintained in the database.

## Future Considerations

- **Additional CLI tool adapters** — support for ChatGPT CLI, Codex, and other tools via the adapter interface.
- **Remote execution** — running agents on remote servers instead of local tmux sessions.
- **Multi-user support** — multiple humans overseeing the same project.
- **Integration with external trackers** — syncing issues with GitHub Issues, Linear, or Jira.
- **Multiple projects running simultaneously** — with global resource management across projects.
