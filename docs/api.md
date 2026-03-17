---
title: CrewDeck API Specification
version: 0.2.0
status: draft
---

# CrewDeck — API Specification

## Overview

The backend exposes a REST API for CRUD operations and a WebSocket server for real-time events. All REST endpoints return JSON. All request bodies are JSON.

**Base URL:** `http://localhost:<port>/api/v1`

**Configuration:** Port and other settings are configured via environment variables (`.env` file).

**Validation:** All request bodies are validated with Zod schemas. Invalid requests return a `VALIDATION_ERROR` response.

**CORS:** Enabled for local frontend development (configurable allowed origins).

## REST API

### Projects

#### List Projects

```
GET /projects
GET /projects?stats
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| stats | flag | When present (any value), returns each project with computed stats fields. |

**Response:** `200 OK`

Without `?stats`:
```json
[
  {
    "id": "uuid",
    "name": "My Project",
    "description": "...",
    "max_concurrency": 3,
    "max_review_rounds": 3,
    "orchestrator_session_id": "uuid | null",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
]
```

With `?stats`:
```json
[
  {
    "id": "uuid",
    "name": "My Project",
    "description": "...",
    "max_concurrency": 3,
    "max_review_rounds": 3,
    "orchestrator_session_id": "uuid | null",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601",
    "repo_count": 2,
    "agent_count": 4,
    "issues": {
      "open": 3,
      "in_progress": 1,
      "in_review": 0,
      "ready": 1,
      "done": 12
    },
    "orchestrator_status": "active | idle | error | none"
  }
]
```

#### Get Project

```
GET /projects/:id
```

**Response:** `200 OK` — Single project object (same shape as list item).

**Error:** `404 Not Found` — Project does not exist.

#### Create Project

```
POST /projects
```

**Request Body:**
```json
{
  "github_url": "https://github.com/owner/repo",
  "name": "Optional override",
  "description": "Optional override",
  "github_account_id": "uuid"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| github_url | Yes | — | GitHub URL of the repository to link to this project. |
| name | No | Repo name from GitHub API | Project name. |
| description | No | Repo description from GitHub API | Project description. |
| github_account_id | No | null | ID of a connected GitHubAccount to use for git operations in this project. |

**Response:** `201 Created` — The created project object.

**Error:** `400 VALIDATION_ERROR` — If `github_url` is invalid or the repository cannot be cloned.

**Side effects:** The backend fetches repo metadata (name, description, default branch) from the GitHub API and clones the repository. If `github_account_id` is provided, the token is used for the API call and git operations; otherwise metadata is fetched unauthenticated with a fallback to URL-derived values on failure.

#### Update Project

```
PATCH /projects/:id
```

**Request Body:** Any subset of project fields (name, description, max_concurrency, max_review_rounds).

**Response:** `200 OK` — The updated project object.

#### Delete Project

```
DELETE /projects/:id
```

**Response:** `204 No Content`

**Side effects:** Stops all active sessions, cleans up worktrees, deletes all related data (cascading).

---

### GitHub Accounts

Manages GitHub accounts connected via Device Flow OAuth. Requires `GITHUB_CLIENT_ID` (and optionally `GITHUB_CLIENT_SECRET`) to be configured on the backend.

#### Initiate Device Flow

```
POST /github-accounts/device-code
```

**Request Body:**
```json
{
  "client_id": "optional-override"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| client_id | No | Overrides `GITHUB_CLIENT_ID` env var. |

**Response:** `200 OK` — GitHub device code response (user_code, verification_uri, device_code, expires_in, interval).

#### Poll for Token

```
POST /github-accounts/device-code/poll
```

Polls GitHub for an access token after the user has authorized on GitHub.

**Request Body:**
```json
{
  "device_code": "...",
  "client_id": "optional-override"
}
```

**Response:**

On success (`201 Created`): GitHubAccount object (without `oauth_token`):
```json
{
  "id": "uuid",
  "account_name": "octocat",
  "github_username": "octocat",
  "scopes": "repo,read:org",
  "created_at": "ISO 8601"
}
```

While pending (`200 OK`):
```json
{
  "status": "pending",
  "error": "authorization_pending",
  "error_description": "..."
}
```

#### List GitHub Accounts

```
GET /github-accounts
```

**Response:** `200 OK` — Array of GitHubAccount objects (without `oauth_token`).

#### Delete GitHub Account

```
DELETE /github-accounts/:id
```

Disconnects the account. Best-effort token revocation is attempted. Projects referencing this account will have `github_account_id` set to null.

**Response:** `204 No Content`

**Error:** `404 Not Found` — Account does not exist.

---

### Repos

#### List Repos for a Project

```
GET /projects/:projectId/repos
```

**Response:** `200 OK` — Array of repo objects.

#### Add Repo to Project

```
POST /projects/:projectId/repos
```

**Request Body:**
```json
{
  "github_url": "https://github.com/org/repo",
  "default_branch": "main"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| github_url | Yes | — | Full GitHub URL. Name and owner are parsed from this. |
| default_branch | No | main | Default branch name. |

**Response:** `201 Created` — The created repo object.

**Side effects:** The backend clones the repo to a managed directory if not already present.

**Validation:**
- github_url must be a valid GitHub URL.
- github_url must not already be linked to this project.
- Repository must be reachable and cloneable; otherwise returns `400 VALIDATION_ERROR`.

#### Remove Repo from Project

```
DELETE /projects/:projectId/repos/:repoId
```

**Response:** `204 No Content`

---

### Crew

#### Get Crew for a Project

```
GET /projects/:projectId/crew
```

**Response:** `200 OK` — Crew object with nested agents array.

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "name": "Backend Team",
  "agents": [
    {
      "id": "uuid",
      "name": "Alice",
      "title": "Senior Software Engineer",
      "description": "Focuses on backend services and API design.",
      "is_captain": false,
      "status": "idle | working | reviewing",
      "current_issue": { "id": "uuid", "title": "Fix login bug" } | null
    }
  ],
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

**Note:** The crew is automatically created when a project is created.

#### Update Crew

```
PATCH /projects/:projectId/crew
```

**Request Body:**
```json
{
  "name": "New Crew Name"
}
```

**Response:** `200 OK` — Updated crew object.

---

### Agents

#### List Agents in a Crew

```
GET /projects/:projectId/crew/agents
```

**Response:** `200 OK` — Array of agent objects.

#### Get Agent

```
GET /projects/:projectId/crew/agents/:agentId
```

**Response:** `200 OK` — Single agent object including full system_prompt.

#### Create Agent

```
POST /projects/:projectId/crew/agents
```

**Request Body:**
```json
{
  "name": "Alice",
  "title": "Senior Software Engineer",
  "description": "Focuses on backend services and API design.",
  "system_prompt": "You are a senior software engineer...",
  "is_captain": false
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| name | Yes | — | Agent name. |
| title | Yes | — | Professional title. |
| description | No | null | Short description of the agent's focus. |
| system_prompt | Yes | — | Full system prompt. |
| is_captain | No | false | Designate this agent as the crew's captain. Only one captain is allowed per crew — setting this demotes the previous captain. |

**Response:** `201 Created` — The created agent object.

#### Generate Agent Prompt

```
POST /projects/:projectId/crew/agents/generate
```

Uses the CLI tool to generate an agent configuration from a short description.

**Request Body:**
```json
{
  "prompt": "A security expert focused on OWASP top 10 vulnerabilities and secure coding practices"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| prompt | Yes | Short description of the desired agent (max 2000 chars). |

**Response:** `200 OK`
```json
{
  "name": "Rex",
  "title": "Security Analyst",
  "description": "Specializes in OWASP top 10 vulnerabilities and secure coding practices.",
  "system_prompt": "You are a security expert specializing in..."
}
```

**Note:** This does not create the agent. The user reviews the generated values and then calls Create Agent.

#### Update Agent

```
PATCH /projects/:projectId/crew/agents/:agentId
```

**Request Body:** Any subset of agent fields.

**Response:** `200 OK` — The updated agent object.

#### Delete Agent

```
DELETE /projects/:projectId/crew/agents/:agentId
```

**Response:** `204 No Content`

**Validation:** Cannot delete an agent that is currently assigned to an active issue (status in_progress, in_review, or feedback).

---

### Issues

#### List Issues for a Project

```
GET /projects/:projectId/issues
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| status | TEXT | Filter by status. Comma-separated for multiple (e.g., `open,in_progress`). |
| assigned_agent_id | TEXT | Filter by assigned agent. |
| created_by | TEXT | Filter by creator (`user` or `orchestrator`). |
| sort | TEXT | Sort field. One of: `priority`, `created_at`, `updated_at`. Default: `priority`. |
| order | TEXT | Sort order. `asc` or `desc`. Default: `desc`. |

**Response:** `200 OK` — Array of issue objects (without full comment thread).

#### Get Issue

```
GET /projects/:projectId/issues/:issueId
```

**Response:** `200 OK` — Full issue object including comments, linked agents, linked PRs, and activity log.

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "title": "Fix authentication bug",
  "description": "...",
  "status": "in_review",
  "priority": 8,
  "assigned_agent_id": "uuid",
  "assigned_agent": { "id": "uuid", "name": "Alice", "title": "..." },
  "created_by": "user",
  "max_review_rounds": null,
  "current_review_round": 1,
  "branch_name": "crewdeck/issue-uuid-short",
  "worktree_path": "/path/to/worktree",
  "base_branch": "main",
  "repo_id": "uuid",
  "repo": { "id": "uuid", "name": "repo", "owner": "org" },
  "comments": [...],
  "agents": [...],
  "pull_requests": [...],
  "activity_log": [...],
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

#### Create Issue

```
POST /projects/:projectId/issues
```

**Request Body:**
```json
{
  "title": "Fix authentication bug",
  "description": "The login endpoint returns 500 when...",
  "max_review_rounds": 5
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| title | Yes | — | Issue title. |
| description | Yes | — | Issue description. |
| max_review_rounds | No | null | Override project default. |

**Response:** `201 Created` — The created issue object with status `open`.

**Side effects:**
- ActivityLog entry created.
- WebSocket event emitted: `issue.created`.
- Orchestrator session resumed to evaluate the new issue.

#### Update Issue

```
PATCH /projects/:projectId/issues/:issueId
```

**Request Body:** Any subset of issue fields (title, description, status, priority, max_review_rounds).

**Response:** `200 OK` — The updated issue object.

**Side effects:**
- ActivityLog entry for each changed field.
- WebSocket event emitted: `issue.updated`.

**Note:** Status changes have specific validation rules (see Status Transitions below).

#### Approve Draft Issue

```
POST /projects/:projectId/issues/:issueId/approve
```

Transitions a draft issue to open status.

**Validation:** Issue must have status `draft`.

**Response:** `200 OK` — The updated issue object with status `open`.

**Side effects:**
- ActivityLog entry.
- WebSocket event: `issue.approved`.
- Orchestrator resumed to prioritize and assign.

#### Discard Draft Issue

```
POST /projects/:projectId/issues/:issueId/discard
```

Removes a draft issue.

**Validation:** Issue must have status `draft`.

**Response:** `204 No Content`

#### Create Pull Request

```
POST /projects/:projectId/issues/:issueId/create-pr
```

Creates a GitHub PR using `gh` CLI from the issue's branch.

**Request Body:**
```json
{
  "title": "Fix authentication bug",
  "body": "Resolves issue #...",
  "target_branch": "main"
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| title | No | Issue title | PR title. |
| body | No | Auto-generated from issue | PR body. |
| target_branch | No | Repo default branch | Target branch for the PR. |

**Validation:** Issue must have status `ready`. Branch must exist.

**Response:** `201 Created` — IssuePR object with GitHub PR details.

**Side effects:**
- Issue status changes to `pr_created`.
- ActivityLog entry.
- WebSocket event: `pr.created`.

---

### Comments

#### List Comments for an Issue

```
GET /projects/:projectId/issues/:issueId/comments
```

**Response:** `200 OK` — Array of comment objects, ordered by created_at ascending.

```json
[
  {
    "id": "uuid",
    "issue_id": "uuid",
    "author_type": "agent",
    "author_id": "uuid",
    "author": { "id": "uuid", "name": "Alice", "title": "Senior Engineer" },
    "content": "I've identified the root cause...",
    "created_at": "ISO 8601"
  }
]
```

#### Add Comment

```
POST /projects/:projectId/issues/:issueId/comments
```

**Request Body:**
```json
{
  "content": "Please also check the session handling."
}
```

**Response:** `201 Created` — The created comment object (author_type = `user`).

**Side effects:**
- WebSocket event: `comment.added`.
- ActivityLog entry.

**Note:** Agent and orchestrator comments are created internally by the system, not through this endpoint.

#### Edit Comment

```
PATCH /projects/:projectId/issues/:issueId/comments/:commentId
```

**Request Body:**
```json
{
  "content": "Updated comment text."
}
```

**Response:** `200 OK` — The updated comment object.

**Error:** `403 Forbidden` — Cannot edit agent or orchestrator comments (author_type ≠ `user`).

**Side effects:**
- WebSocket event: `comment.updated`.

#### Delete Comment

```
DELETE /projects/:projectId/issues/:issueId/comments/:commentId
```

**Response:** `204 No Content`

**Error:** `403 Forbidden` — Cannot delete agent or orchestrator comments (author_type ≠ `user`).

**Side effects:**
- WebSocket event: `comment.deleted`.

---

### Sessions

#### List Active Sessions

```
GET /projects/:projectId/sessions
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| status | TEXT | Filter by status (`idle`, `running`, `completed`, `error`). |
| session_type | TEXT | Filter by type (`captain`, `worker`, `reviewer`, `utility`). |

**Response:** `200 OK` — Array of session objects.

#### Get Session

```
GET /projects/:projectId/sessions/:sessionId
```

**Response:** `200 OK` — Session object including tmux session name and status.

#### Get Session Output

```
GET /projects/:projectId/sessions/:sessionId/output
```

Returns the current tmux pane output for live terminal rendering.

**Response:** `200 OK`
```json
{
  "output": "...",
  "is_active": true
}
```

**Note:** For real-time streaming, use the WebSocket channel instead.

---

### Activity Log

#### List Activity for a Project

```
GET /projects/:projectId/activity
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| issue_id | TEXT | Filter by issue. |
| actor_type | TEXT | Filter by actor type. |
| action | TEXT | Filter by action (e.g., `issue.status_changed`). |
| since | DATETIME | Only entries after this timestamp. Must be a valid date (ISO 8601 or any format parseable by `new Date()`). Invalid values return `400 VALIDATION_ERROR`. |
| limit | INTEGER | Max entries to return. Default: 50. Max: 500. |
| offset | INTEGER | Pagination offset. Default: 0. |

**Response:** `200 OK` — Array of activity log entries, ordered by created_at descending.

---

### Captain Messages

#### List Captain Messages

```
GET /projects/:projectId/captain/messages
```

Returns the captain's decision timeline for the project, ordered by `created_at` ascending.

**Response:** `200 OK` — Array of CaptainMessage objects.

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "author_type": "captain",
    "author_id": "uuid | null",
    "content": "Assigned Alice to issue #12 based on her backend expertise.",
    "context": { "action": "assign", "issue_id": "uuid", "agent_id": "uuid" },
    "created_at": "ISO 8601"
  }
]
```

**Error:** `404 Not Found` — Project does not exist.

#### Send Captain Message

```
POST /projects/:projectId/captain/messages
```

Send a user message to influence captain behavior. The orchestrator is resumed after the message is stored.

**Request Body:**
```json
{
  "content": "Please prioritize the authentication issues."
}
```

| Field | Required | Description |
|-------|----------|-------------|
| content | Yes | Message content (max 10000 chars). |

**Response:** `201 Created` — The created CaptainMessage object (author_type = `user`).

**Side effects:**
- WebSocket event emitted: `captain.message`.
- Orchestrator session resumed.

**Error:** `404 Not Found` — Project does not exist.

---

### Internal API (Agent CLI)

These endpoints are used exclusively by the CrewDeck CLI running inside agent tmux sessions. They are not intended for frontend or external use. See [Agent CLI](agent-cli.md) for the full CLI specification.

#### Signal Event

```
POST /internal/signal
```

Receives a signal from an agent (work complete, review complete, error, needs help).

**Request Body:**
```json
{
  "session_id": "uuid",
  "agent_id": "uuid",
  "issue_id": "uuid",
  "project_id": "uuid",
  "event": "work-complete",
  "data": {}
}
```

**Response:** `200 OK`

**Side effects:** Emits event on the event bus. Triggers Orchestrator Manager, WebSocket broadcast, Activity Logger.

#### Post Comment (Internal)

```
POST /internal/comment
```

Agent posts a comment on its current issue.

**Request Body:**
```json
{
  "session_id": "uuid",
  "agent_id": "uuid",
  "issue_id": "uuid",
  "project_id": "uuid",
  "message": "Fixed the bug, added tests"
}
```

**Response:** `201 Created`

#### Update Status (Internal)

```
POST /internal/status
```

Agent updates its status on the current issue.

**Request Body:**
```json
{
  "session_id": "uuid",
  "agent_id": "uuid",
  "issue_id": "uuid",
  "project_id": "uuid",
  "state": "active"
}
```

**Response:** `200 OK`

#### Report Files (Internal)

```
POST /internal/files
```

Agent reports which files were modified.

**Request Body:**
```json
{
  "session_id": "uuid",
  "modified": ["src/auth/middleware.ts", "tests/auth.test.ts"]
}
```

**Response:** `200 OK`

---

## Status Transition Rules

Issue status changes are validated to ensure a valid lifecycle:

| From | Allowed Transitions |
|------|---------------------|
| draft | open (via approve), deleted (via discard) |
| open | in_progress |
| in_progress | in_review |
| in_review | feedback, ready |
| feedback | in_progress |
| in_progress (after feedback) | in_review |
| ready | pr_created |
| pr_created | done |

Any status can transition to `done` if manually closed by the user.

---

## WebSocket API

### Project Events Connection

```
ws://localhost:<port>/ws?projectId=<uuid>
```

Clients connect with a project ID to receive events scoped to that project.

### Terminal PTY Connection

```
ws://localhost:<port>/terminal-ws?sessionId=<uuid>
```

Opens a bidirectional PTY connection to a session's tmux terminal via `node-pty`. Raw terminal data (ANSI escape sequences, cursor positioning, colors) flows from the PTY to the client, and terminal input flows from the client to the PTY.

**Client → Server messages:**
- Raw terminal input (keystrokes): sent as plain text
- Resize: `{ "type": "resize", "cols": <number>, "rows": <number> }`

**Server → Client messages:**
- Raw PTY output (binary/text terminal data)

### Event Format

All events follow this structure:

```json
{
  "event": "event.name",
  "data": { ... },
  "timestamp": "ISO 8601"
}
```

### Events

#### Issue Events

| Event | Description | Data |
|-------|-------------|------|
| `issue.created` | New issue created | Full issue object |
| `issue.updated` | Issue fields changed | Issue ID + changed fields |
| `issue.approved` | Draft issue approved | Issue object with new status |
| `issue.status_changed` | Status transition | `{ issue_id, from, to }` |
| `issue.assigned` | Agent assigned to issue | `{ issue_id, agent_id, agent_name }` |

#### Comment Events

| Event | Description | Data |
|-------|-------------|------|
| `comment.added` | New comment on an issue | Full comment object |
| `comment.updated` | User comment was edited | Full comment object |
| `comment.deleted` | User comment was deleted | `{ comment_id, issue_id }` |

#### Session Events

| Event | Description | Data |
|-------|-------------|------|
| `session.started` | New tmux session created | `{ session_id, tmux_session_name, agent_id?, issue_id? }` — `agent_id` and `issue_id` are omitted for orchestrator sessions |
| `session.ended` | Session completed or stopped | `{ session_id, status }` |

#### Agent Events

| Event | Description | Data |
|-------|-------------|------|
| `agent.finished` | Agent completed its task | `{ session_id, agent_id, issue_id, role }` |
| `agent.status_changed` | Agent status updated | `{ agent_id, issue_id, state }` |
| `agent.error` | Agent encountered an unrecoverable error | `{ session_id, agent_id, issue_id, message? }` |
| `agent.needs_help` | Agent is requesting human assistance | `{ session_id, agent_id, issue_id, message? }` |

#### Review Events

| Event | Description | Data |
|-------|-------------|------|
| `review.completed` | Reviewer submitted a verdict | `{ session_id, issue_id, agent_id, verdict }` |

#### PR Events

| Event | Description | Data |
|-------|-------------|------|
| `pr.created` | PR created on GitHub | Full IssuePR object |
| `pr.status_changed` | PR status updated | `{ pr_id, from, to }` |

#### Orchestrator Events

| Event | Description | Data |
|-------|-------------|------|
| `orchestrator.decision` | Orchestrator made a decision | `{ action, details }` |
| `orchestrator.draft_issue` | Orchestrator proposed a new issue | Full draft issue object |

#### Captain Events

| Event | Description | Data |
|-------|-------------|------|
| `captain.message` | New captain or user message in the project chat | Full CaptainMessage object |

---

## Error Format

All error responses follow this structure:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable error message",
    "details": { ... }
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| NOT_FOUND | 404 | Resource does not exist. |
| VALIDATION_ERROR | 400 | Request body fails validation. |
| INVALID_TRANSITION | 400 | Invalid status transition. |
| CONFLICT | 409 | Operation conflicts with current state (e.g., deleting active agent). |
| INTERNAL_ERROR | 500 | Unexpected server error. |
