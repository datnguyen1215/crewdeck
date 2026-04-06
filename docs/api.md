---
title: CrewDeck API Specification
version: 0.3.0
status: draft
---

# CrewDeck — API Specification

## Overview

The backend exposes a REST API for CRUD operations and a WebSocket server for real-time events. All REST endpoints return JSON. All request bodies are JSON.

**Base URL:** `http://localhost:<port>/api/v1`

**Health check:** `GET /health` returns `{ "status": "ok" }` (outside the `/api/v1` prefix). This endpoint is exempt from authentication.

**Authentication:** All endpoints except `GET /health`, `GET /api/v1/auth/setup-status`, and `POST /api/v1/auth/setup` require authentication. Two methods are supported:

1. **Session cookie** (`session_token`) — used by browser clients after login.
2. **API key** via `Authorization: Bearer <key>` header — used by agent/captain processes and external tools.

The auth middleware checks for a Bearer token first, then falls back to the session cookie. API key-authenticated requests set a synthetic session with `username` prefixed by `api-key:` and attach the key's metadata (including parsed scopes) to `req.apiKey`. Scope-based authorization is enforced via the `requireScope(...scopes)` middleware factory — session-authenticated requests (admin users) always bypass scope checks, and API keys with `null` scopes are unrestricted. Unauthenticated requests return `403 FORBIDDEN`. See [Authentication](#authentication) for the auth endpoints and [API Keys](#api-keys) for key management.

**Configuration:** Port and other settings are configured via environment variables (`.env` file).

**Validation:** All request bodies are validated with Zod schemas. Issue and PR status fields are validated as enums against the centralized status constants defined in `backend/src/constants/statuses.ts`. Invalid requests return a `VALIDATION_ERROR` response.

## REST API

### Authentication

All endpoints except `GET /health`, `GET /api/v1/auth/setup-status`, and `POST /api/v1/auth/setup` require authentication via either a session cookie (`session_token`) or an API key (`Authorization: Bearer <key>` header). Sessions are managed via HTTP-only cookies; API keys are managed via the [API Keys](#api-keys) endpoints.

#### Check Setup Status

```
GET /auth/setup-status
```

Returns whether an admin account has been created.

**Response:** `200 OK`

```json
{ "needsSetup": true }
```

#### Create Admin Account

```
POST /auth/setup
```

Creates the initial admin account. Only works when no admin exists.

**Request body:**

| Field    | Type   | Constraints      |
| -------- | ------ | ---------------- |
| username | string | 1–100 characters |
| password | string | Min 8 characters |

**Response:** `201 Created`

```json
{ "id": "uuid", "username": "admin" }
```

**Errors:**

- `409 CONFLICT` — Admin account already exists.
- `400 VALIDATION_ERROR` — Invalid request body.

#### Login

```
POST /auth/login
```

Validates credentials and creates a session. Rate limited to 5 attempts per minute per IP.

**Request body:**

| Field    | Type   | Constraints |
| -------- | ------ | ----------- |
| username | string | Non-empty   |
| password | string | Non-empty   |

**Response:** `200 OK`

```json
{ "id": "uuid", "username": "admin" }
```

Sets `session_token` cookie (HttpOnly, Secure in production, SameSite=Strict).

**Errors:**

- `403 FORBIDDEN` — Invalid credentials or rate limit exceeded.

#### Logout

```
POST /auth/logout
```

Deletes the session and clears the cookie.

**Response:** `200 OK`

```json
{ "ok": true }
```

#### Get Current User

```
GET /auth/me
```

Returns the current authenticated user info.

**Response:** `200 OK`

```json
{ "id": "uuid", "username": "admin", "setupCompleted": false }
```

`setupCompleted` is `false` until the user completes setup (either by creating a project or by calling `POST /auth/complete-setup`), then becomes `true`.

#### Complete Setup

```
POST /auth/complete-setup
```

Marks the current user's setup as completed. Decouples setup completion from project creation so a setup wizard can finish setup before the user creates their first project.

**Response:** `200 OK`

```json
{ "ok": true }
```

**Errors:**

- `403 FORBIDDEN` — Not authenticated.

### Projects

#### List Projects

```
GET /projects
GET /projects?stats
```

**Query Parameters:**

| Parameter | Type | Description                                                                |
| --------- | ---- | -------------------------------------------------------------------------- |
| stats     | flag | When present (any value), returns each project with computed stats fields. |

**Response:** `200 OK`

Without `?stats`:

```json
[
  {
    "id": "uuid",
    "name": "My Project",
    "description": "...",
    "model": "sonnet",
    "auto_start": false,
    "auto_merge": false,
    "vcs_account_id": "uuid | null",
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
    "model": "sonnet",
    "auto_start": false,
    "auto_merge": false,
    "vcs_account_id": "uuid | null",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601",
    "repo_count": 2,
    "issues": {
      "open": 3,
      "in_progress": 1,
      "pr_created": 0,
      "pr_conflict": 0,
      "pr_failed_actions": 0,
      "pr_ready_to_merge": 0,
      "done": 12
    },
    "active_runs": 1
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
  "repo_url": "https://github.com/owner/repo",
  "name": "Optional override",
  "description": "Optional override",
  "default_base_branch": "develop",
  "vcs_account_id": "uuid"
}
```

| Field                | Required | Default                          | Description                                                                                                              |
| -------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| repo_url             | Yes      | —                                | Repository URL (GitHub, GitLab, etc.) to link to this project.                                                           |
| name                 | No       | Repo name from VCS API           | Project name.                                                                                                            |
| description          | No       | Repo description from VCS API    | Project description.                                                                                                     |
| default_base_branch  | No       | Auto-detected from VCS API       | Default base branch for PRs and worktrees. Overrides VCS auto-detection. Must be a non-empty string if provided.         |
| vcs_account_id       | No       | null                             | ID of a connected VCSAccount to use for git operations in this project.                                                  |

**Response:** `201 Created` — The created project object.

**Error:** `400 VALIDATION_ERROR` — If `repo_url` is invalid, the repository cannot be cloned, or `default_base_branch` is an empty string.

**Side effects:** The backend fetches repo metadata (name, description, default branch) from the VCS provider API and clones the repository. The project's `default_base_branch` is resolved in this order: (1) `default_base_branch` from the request body if provided, (2) the repo's actual default branch from the VCS API, (3) `"main"` as a final fallback. The captain monitor is started immediately for the new project. If `vcs_account_id` is provided, the token is used for the API call and git operations; otherwise metadata is fetched unauthenticated with a fallback to URL-derived values on failure.

#### Update Project

```
PATCH /projects/:id
```

**Request Body:** Any subset of project fields (name, description, model, auto_start, auto_merge, vcs_account_id).

| Field      | Type    | Description                                                              |
| ---------- | ------- | ------------------------------------------------------------------------ |
| model      | TEXT    | Default Claude model for agent spawning. One of: `sonnet`, `opus`.       |
| auto_start | BOOLEAN | Whether Captain automatically starts work on new issues. Default: false. |
| auto_merge | BOOLEAN | Whether Captain automatically merges ready PRs. Default: false.          |

**Response:** `200 OK` — The updated project object.

#### Delete Project

```
DELETE /projects/:id
```

**Response:** `204 No Content`

**Side effects:** Kills any active agent processes, cleans up worktrees, deletes all related data (cascading).

#### Get Captain Status

```
GET /projects/:id/captain/status
```

Returns the current captain monitor phase for the project. Use this on page load to hydrate UI state (show spinner, action detail, etc.) without waiting for WebSocket events.

**Response:** `200 OK`

```json
{
  "status": "idle",
  "detail": null,
  "pending_count": 0,
  "processing_since": null,
  "processing_duration_ms": null
}
```

| Field                  | Type             | Description                                                                                       |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| status                 | TEXT             | Current phase. One of: `idle`, `receiving`, `thinking`, `executing`.                              |
| detail                 | TEXT \| null     | Human-readable detail for the current phase (e.g. `"Analyzing 3 events"`). NULL when idle.        |
| pending_count          | INTEGER          | Number of events queued for the captain to process.                                               |
| processing_since       | DATETIME \| null | UTC timestamp (SQLite `CURRENT_TIMESTAMP` format) when the current cycle started. NULL when idle. |
| processing_duration_ms | INTEGER \| null  | Milliseconds elapsed since `processing_since`. Computed server-side. NULL when idle.              |

**Phase transitions:**

- `idle` → `receiving` — a new event arrives while the captain is idle
- `receiving` → `thinking` — the event queue is drained and the LLM call begins
- `thinking` → `executing` — the LLM produced an action plan and the backend is executing it
- `executing` → `idle` — all actions complete (or the cycle errors out)

**Note:** When a new event arrives while the captain is already `thinking` or `executing`, the status is **not** regressed to `receiving` — the more-advanced phase is preserved. WebSocket events (`monitor.thinking`, `monitor.message`, `monitor.tool_call`, `monitor.tool_result`, `monitor.rate_limit`, `monitor.result`, `monitor.complete`) continue to provide real-time granularity; this REST endpoint is for hydration on page load only.

**Error:** `404 Not Found` — Project does not exist.

---

#### Get Librarian Status

```
GET /projects/:id/librarian-status
```

Returns the status of the most recent librarian (knowledge scan) run for the project.

**Response:** `200 OK`

```json
{
  "status": "completed | running | queued | failed | timeout | null",
  "started_at": "ISO 8601 | null",
  "completed_at": "ISO 8601 | null"
}
```

| Field        | Type     | Description                                                                            |
| ------------ | -------- | -------------------------------------------------------------------------------------- |
| status       | TEXT     | Status of the latest librarian run. NULL if no librarian has ever run on this project. |
| started_at   | DATETIME | When the librarian run started. NULL if no run exists.                                 |
| completed_at | DATETIME | When the librarian run completed. NULL if still running or no run exists.              |

**Error:** `404 Not Found` — Project does not exist.

---

### VCS Accounts

Manages VCS accounts (GitHub, GitLab, etc.) connected via Device Flow OAuth. GitHub accounts require `GITHUB_CLIENT_ID` (and optionally `GITHUB_CLIENT_SECRET`) to be configured on the backend.

#### Initiate Device Flow

```
POST /vcs-accounts/device-code
```

**Request Body:**

```json
{
  "client_id": "optional-override"
}
```

| Field     | Required | Description                           |
| --------- | -------- | ------------------------------------- |
| client_id | No       | Overrides `GITHUB_CLIENT_ID` env var. |

**Response:** `200 OK` — VCS provider device code response (user_code, verification_uri, device_code, expires_in, interval).

#### Poll for Token

```
POST /vcs-accounts/device-code/poll
```

Polls the VCS provider for an access token after the user has authorized.

**Request Body:**

```json
{
  "device_code": "...",
  "client_id": "optional-override"
}
```

**Response:**

On success (`201 Created`): VCSAccount object (without `token`):

```json
{
  "id": "uuid",
  "provider": "github",
  "account_name": "octocat",
  "username": "octocat",
  "scopes": "repo,workflow",
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

#### List VCS Accounts

```
GET /vcs-accounts
```

**Response:** `200 OK` — Array of VCSAccount objects (without `token`).

#### Delete VCS Account

```
DELETE /vcs-accounts/:id
```

Disconnects the account. Best-effort token revocation is attempted (requires both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` for GitHub accounts).

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
  "repo_url": "https://github.com/org/repo",
  "default_branch": "main"
}
```

| Field          | Required | Default | Description                                               |
| -------------- | -------- | ------- | --------------------------------------------------------- |
| repo_url       | Yes      | —       | Full repository URL. Name and owner are parsed from this. |
| default_branch | No       | main    | Default branch name.                                      |

**Response:** `201 Created` — The created repo object.

**Side effects:** The backend clones the repo to a managed directory if not already present. Uses the project's linked VCS account token when available.

**Validation:**

- repo_url must be a valid repository URL.
- repo_url must not already be linked to this project.
- Repository must be reachable and cloneable; otherwise returns `400 VALIDATION_ERROR`.

#### Remove Repo from Project

```
DELETE /projects/:projectId/repos/:repoId
```

**Response:** `204 No Content`

---

### Crew / Agents

The crew is a fixed set of 5 global agents (engineer, lead, docs, librarian, captain). These are hardcoded and immutable. Both `/crew` and `/agents` return the same data, including all dispatchable agents.

#### List Crew

```
GET /crew
GET /agents
```

Both paths return all dispatchable agents (5 agents, including captain). The `/crew` path is canonical; `/agents` is kept for compatibility.

**Response:** `200 OK` — Array of agent objects.

```json
[
  {
    "id": "engineer",
    "name": "Engineer",
    "title": "Software Engineer",
    "description": "Writes and tests production code.",
    "system_prompt": "You are Engineer, a senior software engineer...",
    "dispatchable": true
  }
]
```

| Field         | Type    | Description                                                                                            |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| id            | TEXT    | Agent identifier.                                                                                      |
| name          | TEXT    | Display name.                                                                                          |
| title         | TEXT    | Agent role title.                                                                                      |
| description   | TEXT    | Brief description of the agent's purpose.                                                              |
| system_prompt | TEXT    | System prompt injected into agent processes.                                                           |
| dispatchable  | BOOLEAN | Whether this agent can be dispatched via `/dispatch`. Default: true. All crew agents are dispatchable. |

---

### Issues

#### List Issues for a Project

```
GET /projects/:projectId/issues
```

**Query Parameters:**

| Parameter  | Type    | Description                                                                                       |
| ---------- | ------- | ------------------------------------------------------------------------------------------------- |
| status     | TEXT     | Filter by status. Comma-separated for multiple (e.g., `open,in_progress`). Default excludes `done`. |
| created_by | TEXT     | Filter by creator (`user`, `agent`, or `system`).                                                 |
| sort       | TEXT     | Sort field. One of: `created_at`, `updated_at`. Default: `created_at`.                            |
| order      | TEXT     | Sort order. `asc` or `desc`. Default: `desc`.                                                      |
| limit      | INTEGER | Max issues to return. Default: 50. Max: 100.                                                      |
| offset     | INTEGER | Pagination offset. Default: 0. Must be ≥ 0.                                                       |
| compact    | TEXT     | When `true`, excludes `description` from each issue.                                               |

When no `status` filter is provided, `done` issues are excluded by default. Include them explicitly via `?status=open,in_progress,done`.

**Response:** `200 OK` — Paginated result object containing the issue array and pagination metadata.

```json
{
  "issues": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "title": "Fix authentication bug",
      "status": "in_progress",
      "running_agent_id": "engineer",
      "running_agent_status": "running",
      "dependencies": [
        { "id": "uuid", "title": "Set up database", "status": "done" }
      ],
      "dependents": [],
      "...": "..."
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

| Field  | Type    | Description                                                |
| ------ | ------- | ---------------------------------------------------------- |
| issues | array   | Array of issue objects (without full comment thread).       |
| total  | integer | Total count of matching issues (respecting status filter). |
| limit  | integer | The applied limit (capped at 100).                         |
| offset | integer | The applied offset.                                        |

Each issue in the array includes `running_agent_id`, `running_agent_status`, `dependencies`, and `dependents` fields:

- `running_agent_id`: The ID of the agent currently running or queued on this issue. NULL if no agent is active.
- `running_agent_status`: Either `"running"` or `"queued"`. NULL if no agent is active.
- `dependencies`: Issues this issue is blocked by. Each entry is `{ id, title, status }`. Empty array if none.
- `dependents`: Issues blocked by this issue. Each entry is `{ id, title, status }`. Empty array if none.

**Errors:**

- `400 VALIDATION_ERROR` — `limit` or `offset` is not a valid non-negative integer.

#### Get Issue

```
GET /projects/:projectId/issues/:issueId
```

**Response:** `200 OK` — Full issue object including comments, linked PRs, activity log, and dependency data.

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "title": "Fix authentication bug",
  "description": "...",
  "status": "in_progress",
  "created_by": "user",
  "chain_depth": 2,
  "branch_name": "fix/login-bug-abc1",
  "worktree_path": "/path/to/worktree",
  "base_branch": "main",
  "repo_id": "uuid",
  "repo": { "id": "uuid", "name": "repo" },
  "comments": [...],
  "issue_prs": [...],
  "activity_log": [...],
  "dependencies": [{ "id": "uuid", "title": "Set up database", "status": "done" }],
  "dependents": [],
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

- `dependencies`: Issues this issue is blocked by. Each entry is `{ id, title, status }`. Empty array if none.
- `dependents`: Issues blocked by this issue. Each entry is `{ id, title, status }`. Empty array if none.

#### Create Issue

```
POST /projects/:projectId/issues
```

**Request Body:**

```json
{
  "title": "Fix authentication bug",
  "description": "The login endpoint returns 500 when..."
}
```

| Field       | Required | Default | Description                                                  |
| ----------- | -------- | ------- | ------------------------------------------------------------ |
| title       | Yes      | —       | Issue title.                                                 |
| description | Yes      | —       | Issue description.                                           |
| agent_id    | No       | null    | Assigned agent ID (one of: engineer, lead, docs, librarian). |

**Response:** `201 Created` — The created issue object with status `open` and `created_by: "user"`.

**Side effects:**

- WebSocket event emitted: `issue.created`.

#### Update Issue

```
PATCH /projects/:projectId/issues/:issueId
```

**Request Body:** Any subset of issue fields (title, description, status, chain_depth, agent_id).

**Headers:**

| Header     | Required | Description                                                                                                                                                                |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X-Agent-ID | No       | Agent ID to exclude from the active process check when transitioning to `done`. Allows an agent to mark an issue as done without being blocked by its own running process. |

**Response:** `200 OK` — The updated issue object. If the request only sets a field to its current value (e.g. same status), the issue is returned unchanged.

**Side effects:**

- WebSocket event emitted: `issue.status_changed` (when status changes).

**Note:** Status changes are validated against the transition rules (see Status Transitions below). Transitioning to `done` is rejected if active agent processes are running on the issue (excluding the agent specified in `X-Agent-ID`). Set `chain_depth: 0` to reset the `/dispatch` chain depth counter after the global `max_chain_depth` limit is reached.

#### Delete Issue

```
DELETE /projects/:projectId/issues/:issueId
```

Permanently deletes an issue and cleans up associated resources.

**Response:** `204 No Content`

**Side effects:**

- If the issue has a worktree (`worktree_path`, `branch_name`), it is cleaned up before deletion
- Git worktree is removed from disk
- Associated branch is deleted
- All related database records are deleted
- Cleanup errors are logged but do not block deletion

**Error:** `404 Not Found` — Issue does not exist.

#### Pause Issue

```
POST /projects/:projectId/issues/:issueId/pause
```

Pauses an issue, preventing new agent dispatches, PR creation, and PR merging until resumed.

**Response:** `200 OK`

**Side effects:**

- WebSocket event emitted: `issue.paused`.

#### Resume Issue

```
POST /projects/:projectId/issues/:issueId/resume
```

Resumes a paused issue, allowing agent dispatches again.

**Response:** `200 OK`

**Side effects:**

- WebSocket event emitted: `issue.resumed`.

#### Approve Issue to Start

```
POST /projects/:projectId/issues/:issueId/approve-start
```

Manually approves an issue for work, bypassing the `auto_start` setting. Used when the user clicks the play button on an issue.

**Response:** `200 OK`

```json
{
  "success": true,
  "issue_id": "uuid",
  "approved_to_start": true
}
```

**Validation:**

- Issue must not be paused
- Issue must not be `done`

**Side effects:**

- Issue ID added to in-memory `approvedToStart` Set
- WebSocket event emitted: `issue.approved_to_start`
- Captain receives event and dispatches engineer

#### Approve Issue to Merge

```
POST /projects/:projectId/issues/:issueId/approve-merge
```

Manually approves an issue for merge, bypassing the `auto_merge` setting. Used when the user clicks the merge button on an issue with a PR.

**Response:** `200 OK`

```json
{
  "success": true,
  "issue_id": "uuid",
  "approved_to_merge": true
}
```

**Validation:**

- Issue status must start with `pr_` (has a PR)

**Side effects:**

- Issue ID added to in-memory `approvedToMerge` Set
- WebSocket event emitted: `issue.approved_to_merge`
- Captain receives event and merges PR

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
    "author_type": "user | system | captain | engineer | lead | docs | librarian",
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

**Note:** Agent and system comments are created internally (by agent processes and the MentionHandler), not through this endpoint.

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

**Error:** `403 Forbidden` — Cannot edit non-user comments (author_type ≠ `user`).

**Side effects:**

- WebSocket event: `comment.updated`.

#### Delete Comment

```
DELETE /projects/:projectId/issues/:issueId/comments/:commentId
```

**Response:** `204 No Content`

**Error:** `403 Forbidden` — Cannot delete non-user comments (author_type ≠ `user`).

**Side effects:**

- WebSocket event: `comment.deleted`.

---

### Agent Runs

Records of agent executions, including streamed events from the Claude CLI.

#### List Runs for an Issue

```
GET /projects/:projectId/issues/:issueId/runs
```

**Response:** `200 OK` — Array of AgentRun objects ordered by `created_at` descending.

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "issue_id": "uuid",
    "agent_id": "engineer",
    "pid": 12345,
    "status": "completed",
    "exit_code": 0,
    "cost_usd": 0.023,
    "duration_ms": 14200,
    "started_at": "ISO 8601",
    "completed_at": "ISO 8601",
    "created_at": "ISO 8601"
  }
]
```

Status values: `queued`, `running`, `completed`, `failed`, `timeout`.

#### Get Run with Events

```
GET /projects/:projectId/runs/:runId
GET /projects/:projectId/runs/:runId?events_limit=50
```

**Query Parameters:**

| Parameter    | Type    | Description                                                                                   |
| ------------ | ------- | --------------------------------------------------------------------------------------------- |
| events_limit | INTEGER | Max events to return. Default: 20. Use `0` for all events. Must be a valid number or omitted. |

**Response:** `200 OK` — AgentRun object with an additional `events` array containing all streamed events.

```json
{
  "id": "uuid",
  "...": "...",
  "events": [
    {
      "id": "uuid",
      "agent_run_id": "uuid",
      "type": "assistant",
      "data": { "text": "I'll help with that...", "tool_use": [...] },
      "created_at": "ISO 8601"
    }
  ]
}
```

Event `type` values are strings from Claude CLI stream-json output (e.g., `assistant`, `user`, `tool_use`, `tool_result`, `rate_limit_event`, `result`, `system`, `error`). Events are **normalized** on retrieval — the normalizer (`event-normalizer.ts`) handles both the old flat Claude CLI format (`subtype`/`content` fields) and the new nested format (`message.content[]` arrays), flattening them into a simpler structure:

| Type          | Normalized `data` fields                                                        |
| ------------- | ------------------------------------------------------------------------------- |
| `assistant`   | `text` (string), `thinking` (string), `tool_use` (array of `{id, name, input}`) |
| `user`        | `text` (string), `tool_results` (array of `{tool_use_id, output, is_error?}`)   |
| `tool_use`    | `tool_use` (array of `{id, name, input}`)                                       |
| `tool_result` | `tool_results` (array of `{tool_use_id, output, is_error?}`)                    |
| `system`      | `model` (string), `subtype` (string), `message` (string)                        |
| `result`      | `result` (string), `cost_usd` (number), `duration_ms` (number)                  |
| `error`       | `error` (string)                                                                |

Raw events are stored as-is in the database for debugging; normalization occurs only at retrieval time.

**Error:** `400 VALIDATION_ERROR` — `events_limit` is present but not a valid integer.

**Error:** `404 Not Found` — Run does not exist or belongs to a different project.

#### List Runs for a Project

```
GET /projects/:projectId/runs
GET /projects/:projectId/runs?limit=50&offset=0
```

**Query Parameters:**

| Parameter | Type    | Description                                 |
| --------- | ------- | ------------------------------------------- |
| limit     | INTEGER | Max runs to return. Default: 50. Max: 100.  |
| offset    | INTEGER | Pagination offset. Default: 0. Must be ≥ 0. |

**Response:** `200 OK` — Array of AgentRun objects ordered by `created_at` descending.

#### List Active Runs for a Project

```
GET /projects/:projectId/active-runs
```

Returns currently running or queued agent runs for a project, enriched with agent info, issue info, and the most recent events. Used by the Terminals page to display live agent panes.

**Response:** `200 OK` — Array of enriched AgentRun objects ordered by `created_at` ascending.

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "issue_id": "uuid | null",
    "agent_id": "engineer",
    "pid": 12345,
    "status": "running",
    "exit_code": null,
    "cost_usd": null,
    "duration_ms": null,
    "started_at": "ISO 8601",
    "completed_at": null,
    "created_at": "ISO 8601",
    "agent_name": "Engineer",
    "agent_title": "Software Engineer",
    "issue_title": "Fix login bug",
    "events": [
      {
        "id": "uuid",
        "agent_run_id": "uuid",
        "type": "tool_use",
        "data": { "tool": "Read", "input": { "file_path": "src/auth.ts" } },
        "created_at": "ISO 8601"
      }
    ]
  }
]
```

Each run includes:

- `agent_name` / `agent_title` — resolved from the crew roster.
- `issue_title` — title of the associated issue (null for standalone runs).
- `events` — the 50 most recent `AgentRunEvent` records, ordered by `created_at` ascending. Uses a SQL `LIMIT` subquery to avoid loading all events for long-running agents.

Only runs with status `running` or `queued` are returned.

---

### Activity Log

#### List Global Activity

```
GET /activity
```

Returns recent activity entries across all projects. Entries are enriched with `actor_name` (agent display name), `issue_title`, and `project_name` (the owning project's name). Entries are returned in compact form — the `details` field is omitted, but display-critical fields are promoted to top-level properties: `from`/`to` for `issue.status_changed`, `pr_number` for `pr.created`, and `exit_code` for `mention.completed`.

**Query Parameters:**

| Parameter | Type     | Description                                                                                                                                               |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| since     | DATETIME | Only entries after this timestamp. Must be a valid date (ISO 8601 or any format parseable by `new Date()`). Invalid values return `400 VALIDATION_ERROR`. |
| limit     | INTEGER  | Max entries to return. Default: 10. Max: 50.                                                                                                              |
| offset    | INTEGER  | Pagination offset. Default: 0. Must be ≥ 0.                                                                                                               |

**Response:** `200 OK` — Array of activity log entries, ordered by created_at descending. Each entry includes `actor_name` (for agent and system-with-agent-id entries), `issue_title` (when an associated issue exists), and `project_name` (the owning project's name).

**Error:** `400 VALIDATION_ERROR` — `since` is not a valid date, `limit` is negative, or `offset` is negative.

#### List Activity for a Project

```
GET /projects/:projectId/activity
```

**Query Parameters:**

| Parameter  | Type     | Description                                                                                                                                               |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| issue_id   | TEXT     | Filter by issue.                                                                                                                                          |
| actor_type | TEXT     | Filter by actor type.                                                                                                                                     |
| action     | TEXT     | Filter by action (e.g., `issue.status_changed`).                                                                                                          |
| since      | DATETIME | Only entries after this timestamp. Must be a valid date (ISO 8601 or any format parseable by `new Date()`). Invalid values return `400 VALIDATION_ERROR`. |
| limit      | INTEGER  | Max entries to return. Default: 50. Max: 500.                                                                                                             |
| offset     | INTEGER  | Pagination offset. Default: 0.                                                                                                                            |
| compact    | TEXT     | When `true`, omits the `details` field and promotes display-critical fields to top-level (`from`/`to` for `issue.status_changed`, `pr_number` for `pr.created`, `exit_code` for `mention.completed`). Default: `false` (full details included). |

**Response:** `200 OK` — Array of activity log entries, ordered by created_at descending. Entries where `actor_type` is `agent` include an additional `actor_name` field (string) with the agent's display name. Historical entries where `actor_type` is `system` but `details.agent_id` is present are also enriched with `actor_name`. Entries with an associated issue include an additional `issue_title` field (string) with the issue's title, resolved via batch lookup at query time. When `compact=true`, the `details` field is omitted and action-specific fields are promoted to top-level properties on the entry.

---

### Environment Variables

Per-project environment variables that are automatically injected into agent processes at spawn time.

**Note:** Secret values (`is_secret: true`) are masked as `••••••••` in all API responses. They are stored in plaintext server-side for agent injection only.

#### List Environment Variables

```
GET /projects/:projectId/environment
```

**Response:** `200 OK` — Array of environment variable objects, ordered by key ascending.

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "key": "API_KEY",
    "value": "abc123",
    "is_secret": false,
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
]
```

**Error:** `404 Not Found` — Project does not exist.

#### Create Environment Variable

```
POST /projects/:projectId/environment
```

**Request Body:**

```json
{
  "key": "API_KEY",
  "value": "abc123",
  "is_secret": false
}
```

| Field     | Required | Default | Description                                                     |
| --------- | -------- | ------- | --------------------------------------------------------------- |
| key       | Yes      | —       | Environment variable name. Must match `[A-Za-z_][A-Za-z0-9_]*`. |
| value     | Yes      | —       | Value string.                                                   |
| is_secret | No       | false   | If true, the value is masked in all API responses.              |

**Response:** `201 Created` — The created environment variable object (value masked if secret).

**Error:** `400 VALIDATION_ERROR` — Key fails name format validation.

**Error:** `409 CONFLICT` — A variable with this key already exists in the project.

#### Update Environment Variable

```
PATCH /projects/:projectId/environment/:envVarId
```

**Request Body:** Any subset of fields (key, value, is_secret).

**Response:** `200 OK` — The updated environment variable object.

**Error:** `404 Not Found` — Environment variable does not exist or belongs to a different project.

**Error:** `409 CONFLICT` — Updating key conflicts with an existing variable.

#### Delete Environment Variable

```
DELETE /projects/:projectId/environment/:envVarId
```

**Response:** `204 No Content`

**Error:** `404 Not Found` — Environment variable does not exist or belongs to a different project.

---

### Knowledge

Project knowledge entries provide structured context to agents. See [Data Model](data-model.md#projectknowledge) for the full schema.

#### List Knowledge Entries

```
GET /projects/:projectId/knowledge
```

**Response:** `200 OK` — Array of knowledge entry objects, ordered by updated_at descending.

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "title": "API Conventions",
    "category": "conventions",
    "content": "All endpoints return JSON...",
    "source": "librarian",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
]
```

**Error:** `404 Not Found` — Project does not exist.

#### Get Knowledge Entry

```
GET /projects/:projectId/knowledge/:knowledgeId
```

**Response:** `200 OK` — Single knowledge entry object.

**Error:** `404 Not Found` — Knowledge entry does not exist or belongs to a different project.

#### Create Knowledge Entry

```
POST /projects/:projectId/knowledge
```

**Request Body:**

```json
{
  "title": "API Conventions",
  "category": "conventions",
  "content": "All endpoints return JSON...",
  "source": "user"
}
```

| Field    | Required | Default | Description                                                             |
| -------- | -------- | ------- | ----------------------------------------------------------------------- |
| title    | Yes      | —       | Short title for the entry.                                              |
| category | Yes      | —       | Category for grouping (e.g., `architecture`, `conventions`, `gotchas`). |
| content  | Yes      | —       | The knowledge content.                                                  |
| source   | No       | null    | Optional source reference (e.g., `user`, `librarian`, file path, URL).  |

**Response:** `201 Created` — The created knowledge entry object.

**Error:** `404 Not Found` — Project does not exist.

#### Update Knowledge Entry

```
PATCH /projects/:projectId/knowledge/:knowledgeId
```

**Request Body:** Any subset of fields (title, category, content, source).

**Response:** `200 OK` — The updated knowledge entry object.

**Error:** `404 Not Found` — Knowledge entry does not exist or belongs to a different project.

#### Delete Knowledge Entry

```
DELETE /projects/:projectId/knowledge/:knowledgeId
```

**Response:** `204 No Content`

**Error:** `404 Not Found` — Knowledge entry does not exist or belongs to a different project.

#### Trigger Knowledge Scan

```
POST /projects/:projectId/knowledge/scan
```

Triggers a codebase scan by spawning the librarian agent directly. The agent run is tracked in the `AgentRun` table without an associated issue.

**Response:** `201 Created`

```json
{
  "agent_run_id": "uuid"
}
```

| Field        | Type        | Description                      |
| ------------ | ----------- | -------------------------------- |
| agent_run_id | TEXT (UUID) | The ID of the spawned agent run. |

**Error:** `500 Internal Server Error` — If the global concurrency limit is reached (scans cannot be queued).

**Side effects:**

- Creates an `AgentRun` record with `issue_id: null`.
- Spawns the librarian agent process with the standard agent environment (including `CREWDECK_API_KEY` for API authentication).
- Emits `run.started` event.

---

### Agent Config

Global per-agent model configuration. Applies machine-wide regardless of project. Each agent can be assigned any model from any provider — the model name determines which provider is used.

#### List Agent Configs

```
GET /agent-config
```

**Response:** `200 OK` — Array of agent config objects.

```json
[
  {
    "id": "uuid",
    "agent_id": "engineer",
    "model": "opus"
  },
  {
    "id": "uuid",
    "agent_id": "lead",
    "model": "glm-5.1"
  }
]
```

#### Set Agent Model

```
PUT /agent-config/:agentId
```

Creates or updates the model for a specific agent.

**Request Body:**

```json
{
  "model": "opus"
}
```

| Field    | Required | Description                                                                                                                                                                         |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| provider | Yes      | AI provider. One of: `claude`, `glm`.                                                                                                                                               |
| model    | Yes      | Model to use. For `claude`: `sonnet`, `opus`, `haiku`, or `null`. For `glm`: `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`, or `null`. `null` clears the override for that provider. |

**Response:** `200 OK` — The created or updated agent config object.

#### Remove Agent Model Override

```
DELETE /agent-config/:agentId
```

Removes the model override for the agent, falling back to the global default model.

**Response:** `204 No Content`

---

### Global Config

Global system-wide configuration settings.

#### Get Global Config

```
GET /global-config
```

**Response:** `200 OK` — Current global configuration.

```json
{
  "defaultModel": "sonnet",
  "maxConcurrency": 5,
  "maxChainDepth": 20,
  "agentTimeoutMinutes": 10
}
```

| Field               | Type    | Description                                 |
| ------------------- | ------- | ------------------------------------------- |
| defaultModel        | TEXT    | Default model for agent spawns.             |
| maxConcurrency      | INTEGER | Max concurrent agent processes globally (across all projects). |
| maxChainDepth       | INTEGER | Max agent dispatches per issue.             |
| agentTimeoutMinutes | INTEGER | Agent process timeout in minutes.           |

#### Get Default Model

```
GET /global-config/default-model
```

Returns the default model used when no per-agent override is set.

**Response:** `200 OK`

```json
{
  "model": "sonnet"
}
```

| Field | Type | Description    |
| ----- | ---- | -------------- |
| model | TEXT | Default model. |

#### Set Default Model

```
PUT /global-config/default-model
```

Sets the default model for all agent spawns when no per-agent override is configured.

**Request Body:**

```json
{
  "model": "opus"
}
```

| Field | Required | Description                                                                                     |
| ----- | -------- | ----------------------------------------------------------------------------------------------- |
| model | Yes      | Default model. One of: `sonnet`, `opus`, `haiku`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`. |

**Response:** `200 OK`

```json
{
  "model": "opus"
}
```

#### Get Max Concurrency

```
GET /global-config/max-concurrency
```

Returns the maximum concurrent agent processes globally (across all projects).

**Response:** `200 OK`

```json
{
  "maxConcurrency": 5
}
```

#### Set Max Concurrency

```
PUT /global-config/max-concurrency
```

Sets the maximum concurrent agent processes globally (across all projects).

**Request Body:**

```json
{
  "maxConcurrency": 10
}
```

| Field          | Required | Description               |
| -------------- | -------- | ------------------------- |
| maxConcurrency | Yes      | Max concurrent agents. 1–50. |

**Response:** `200 OK`

```json
{
  "maxConcurrency": 10
}
```

#### Get Max Chain Depth

```
GET /global-config/max-chain-depth
```

Returns the maximum agent dispatches per issue before requiring manual reset.

**Response:** `200 OK`

```json
{
  "maxChainDepth": 20
}
```

#### Set Max Chain Depth

```
PUT /global-config/max-chain-depth
```

Sets the maximum agent dispatches per issue.

**Request Body:**

```json
{
  "maxChainDepth": 30
}
```

| Field        | Required | Description                    |
| ------------ | -------- | ------------------------------ |
| maxChainDepth | Yes      | Max chain depth. 1–100.        |

**Response:** `200 OK`

```json
{
  "maxChainDepth": 30
}
```

#### Get Agent Timeout

```
GET /global-config/agent-timeout-minutes
```

Returns the agent process timeout in minutes.

**Response:** `200 OK`

```json
{
  "agentTimeoutMinutes": 10
}
```

#### Set Agent Timeout

```
PUT /global-config/agent-timeout-minutes
```

Sets the agent process timeout in minutes.

**Request Body:**

```json
{
  "agentTimeoutMinutes": 15
}
```

| Field              | Required | Description                  |
| ------------------ | -------- | ---------------------------- |
| agentTimeoutMinutes | Yes      | Timeout in minutes. 1–60.   |

**Response:** `200 OK`

```json
{
  "agentTimeoutMinutes": 15
}
```

#### Get Active Agents

```
GET /global-config/active-agents
```

Returns the current global agent activity count and the concurrency limit. Used by the dashboard to display the "Active Agents" metric.

**Response:** `200 OK`

```json
{
  "activeAgents": 3,
  "maxConcurrency": 5
}
```

| Field          | Type    | Description                                            |
| -------------- | ------- | ------------------------------------------------------ |
| activeAgents   | INTEGER | Number of currently running agent processes globally.   |
| maxConcurrency | INTEGER | Maximum concurrent agents allowed (global limit).      |

#### List Active Runs (Global)

```
GET /global-config/active-runs
```

Returns all currently running or queued agent runs across every project, enriched with agent info, issue titles, and project names. Used to power a cross-project agent dashboard.

**Query Parameters:**

| Parameter      | Type    | Description                                                                 |
| -------------- | ------- | --------------------------------------------------------------------------- |
| include_events | boolean | When `true`, includes the 50 most recent events per run. Default: `false`.  |

**Response:** `200 OK` — Array of enriched AgentRun objects ordered by `created_at` ascending.

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "issue_id": "uuid | null",
    "agent_id": "engineer",
    "pid": 12345,
    "status": "running",
    "exit_code": null,
    "cost_usd": null,
    "duration_ms": null,
    "started_at": "ISO 8601",
    "completed_at": null,
    "created_at": "ISO 8601",
    "agent_name": "Engineer",
    "agent_title": "Software Engineer",
    "issue_title": "Fix login bug",
    "project_name": "my-project",
    "events": []
  }
]
```

Each run includes:

- `agent_name` / `agent_title` — resolved from the crew roster (falls back to `agent_id` if not found).
- `issue_title` — title of the associated issue (null for standalone runs or if issue not found).
- `project_name` — name of the owning project (null if project was deleted while run was active).
- `events` — when `include_events=true`, the 50 most recent `AgentRunEvent` records ordered by `created_at` ascending; otherwise an empty array.

Only runs with status `running` or `queued` are returned.

#### List Captain Statuses (Global)

```
GET /global-config/captain-statuses
```

Returns the captain monitor phase for every project in a single call. Used to power a cross-project dashboard without polling each project individually.

**Response:** `200 OK` — Array of captain status objects, one per project.

```json
[
  {
    "project_id": "uuid",
    "project_name": "my-project",
    "status": "idle",
    "detail": null,
    "pending_count": 0,
    "processing_since": null,
    "processing_duration_ms": null
  }
]
```

| Field                  | Type             | Description                                                                                       |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| project_id             | TEXT             | UUID of the project.                                                                              |
| project_name           | TEXT             | Display name of the project.                                                                      |
| status                 | TEXT             | Current captain phase. One of: `idle`, `receiving`, `thinking`, `executing`.                      |
| detail                 | TEXT \| null     | Human-readable detail for the current phase. NULL when idle.                                      |
| pending_count          | INTEGER          | Number of events queued for the captain to process.                                               |
| processing_since       | DATETIME \| null | UTC timestamp when the current cycle started. NULL when idle.                                     |
| processing_duration_ms | INTEGER \| null  | Milliseconds elapsed since `processing_since`. Computed server-side. NULL when idle.              |

#### Check Model Availability

```
GET /global-config/model-availability
```

Returns which model providers are available based on configured API keys.

**Response:** `200 OK`

```json
{
  "claude": { "available": true },
  "glm": { "available": true }
}
```

| Field  | Type   | Description                                                        |
| ------ | ------ | ------------------------------------------------------------------ |
| claude | object | Claude availability (always `true` if `ANTHROPIC_API_KEY` is set). |
| glm    | object | GLM (Z.AI) availability (`true` if `ZAI_API_KEY` is set).          |

#### Preflight Checks

Preflight endpoints detect whether the system is ready to run agents. Used by setup wizards to guide users through configuration.

##### Check Claude CLI Installation

```
GET /global-config/preflight/claude-cli
```

Checks whether the `claude` CLI is installed and available on PATH. If found, also retrieves the version string.

**Response:** `200 OK`

When installed:

```json
{ "installed": true, "version": "claude-code/1.0.0", "path": "/usr/local/bin/claude" }
```

When not installed:

```json
{ "installed": false }
```

| Field     | Type    | Description                                      |
| --------- | ------- | ------------------------------------------------ |
| installed | boolean | Whether `claude` is on PATH.                     |
| version   | string  | Version string from `claude --version` (if found). |
| path      | string  | Absolute path to the `claude` binary (if found).   |

##### Check Claude CLI Authentication

```
GET /global-config/preflight/claude-auth
```

Spawns `claude -p "ping" --output-format json --max-turns 1` with a 15-second timeout to verify that Claude CLI credentials are working. This endpoint is slow (~5–10s) by design.

**Response:** `200 OK`

When authenticated:

```json
{ "authenticated": true }
```

When not authenticated:

```json
{ "authenticated": false, "error": "No API key provided. Run `claude` to authenticate." }
```

| Field         | Type    | Description                                                      |
| ------------- | ------- | ---------------------------------------------------------------- |
| authenticated | boolean | Whether Claude CLI successfully authenticated.                   |
| error         | string  | Error message from stderr/stdout when authentication fails (max 500 chars). |

##### Check Z.AI API Key

```
GET /global-config/preflight/zai
```

Checks whether a `ZAI_API_KEY` is configured, either via environment variable or the global environment variables database table. Indicates where the key was found so the UI can guide the user.

**Response:** `200 OK`

When configured:

```json
{ "configured": true, "source": "env" }
```

When not configured:

```json
{ "configured": false }
```

| Field      | Type    | Description                                                          |
| ---------- | ------- | -------------------------------------------------------------------- |
| configured | boolean | Whether a Z.AI API key is available.                                 |
| source     | string  | Where the key was found: `"env"` (environment variable) or `"database"` (GlobalEnvironmentVariable table). Omitted when not configured. |

---

### API Keys

Manage user API keys for programmatic access. Key management endpoints require session authentication — API key-authenticated requests are rejected to prevent keys from managing other keys. System keys (auto-generated for agent/captain use) are hidden from this interface.

#### List API Keys

```
GET /api-keys
```

Returns all user-created API keys (system keys excluded). The full key is never returned — only a prefix for identification.

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "name": "Claude CI Process",
    "key_prefix": "sk-a1b2c3d4",
    "created_at": "ISO 8601",
    "last_used_at": "ISO 8601",
    "scopes": null
  }
]
```

| Field        | Type                | Description                                           |
| ------------ | ------------------- | ----------------------------------------------------- |
| id           | TEXT (UUID)         | Unique identifier.                                    |
| name         | TEXT                | Human-readable label assigned at creation.            |
| key_prefix   | TEXT                | First 11 characters of the key (e.g., `sk-a1b2c3d4`). |
| created_at   | TEXT                | When the key was created.                             |
| last_used_at | TEXT \| null        | When the key was last used for authentication.        |
| scopes       | string[] \| null    | Array of scope strings granted to this key, or `null` for unrestricted (admin-level) access. |

#### Create API Key

```
POST /api-keys
```

Creates a new API key. The full plaintext key is returned **only once** in the response.

**Request Body:**

```json
{
  "name": "Claude CI Process",
  "scopes": ["issues:read", "issues:write"]
}
```

| Field  | Required | Description                                                                                                                            |
| ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| name   | Yes      | Human-readable label for the key.                                                                                                     |
| scopes | No       | Array of scope strings to restrict the key's access. If omitted or `null`, the key is unrestricted (admin-level). Each scope must be a known scope constant. |

**Available scopes:** See `backend/src/constants/scopes.ts` for the full list. All scopes are enforced via `requireScope()` middleware on every route. Common scopes include:

| Scope | Description |
|-------|-------------|
| `issues:read` | Read issues and issue details |
| `issues:create` | Create new issues |
| `issues:update` | Update issue fields (title, description, status) |
| `issues:delete` | Delete issues |
| `issues:pause` | Pause issues |
| `issues:resume` | Resume paused issues |
| `issues:approve` | Approve issues for start or merge |
| `comments:read` | Read comments |
| `comments:create` | Create comments |
| `comments:edit` | Edit comments |
| `comments:delete` | Delete comments |
| `knowledge:read` | Read knowledge entries |
| `knowledge:write` | Create or update knowledge entries |
| `knowledge:delete` | Delete knowledge entries |
| `knowledge:scan` | Trigger knowledge scans |
| `projects:read` | Read projects |
| `projects:write` | Create or update projects |
| `projects:delete` | Delete projects |
| `repos:read` | Read repos |
| `repos:write` | Add repos |
| `repos:delete` | Remove repos |
| `runs:read` | Read agent runs |
| `activity:read` | Read activity log |
| `monitor:read` | Read monitor history |
| `agents:read` | List crew/agents |
| `global-config:read` | Read global config (admin only) |
| `global-config:write` | Update global config (admin only) |
| `vcs-accounts:read` | Read VCS accounts (admin only) |
| `vcs-accounts:write` | Create/update VCS accounts (admin only) |
| `vcs-accounts:delete` | Delete VCS accounts (admin only) |
| `api-keys:read` | List API keys (admin only) |
| `api-keys:write` | Create API keys (admin only) |
| `api-keys:delete` | Delete API keys (admin only) |
| `environment:read` | Read environment variables (admin only) |
| `environment:write` | Create/update environment variables (admin only) |
| `environment:delete` | Delete environment variables (admin only) |
| `chat:read` | Read chat threads (admin only) |
| `chat:write` | Create/update chat threads and messages (admin only) |
| `chat:delete` | Delete chat threads (admin only) |
| `terminal:read` | Read terminal session status (admin only) |
| `terminal:write` | Create terminal sessions (admin only) |
| `terminal:delete` | Destroy terminal sessions (admin only) |
| `agent-config:read` | Read agent config (admin only) |
| `agent-config:write` | Update agent config (admin only) |
| `agent-config:delete` | Delete agent config (admin only) |
| `internal:comment` | Post comments via internal API |
| `internal:create-issue` | Create issues via internal API |
| `internal:create-pr` | Register PRs via internal API |
| `internal:dispatch` | Dispatch agents via internal API |
| `internal:merge` | Merge PRs via internal API |
| `internal:scan` | Scan codebase via internal API |
| `internal:knowledge-read` | Read knowledge via internal API |
| `internal:knowledge-write` | Write knowledge via internal API |

Scopes marked "admin only" are excluded from the system API key. Session-authenticated requests (admin users) always bypass scope checks.

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "name": "Claude CI Process",
  "key_prefix": "sk-a1b2c3d4",
  "created_at": "ISO 8601",
  "last_used_at": null,
  "scopes": null,
  "key": "sk-a1b2c3d4e5f6..."
}
```

The `key` field contains the full plaintext key. It is not stored server-side (only the SHA-256 hash is stored) and will never be shown again. User-created keys default to `scopes: null` (unrestricted access).

**Errors:**

- `400 VALIDATION_ERROR` — `name` is empty or not a string.
- `400 VALIDATION_ERROR` — `scopes` is not an array.
- `400 VALIDATION_ERROR` — `scopes` contains an invalid scope value.

#### Delete API Key

```
DELETE /api-keys/:id
```

Revokes an API key. System keys cannot be deleted.

**Response:** `204 No Content`

**Error:** `404 Not Found` — Key does not exist.

**Error:** `403 Forbidden` — Attempting to delete a system key.

---

### Terminal Sessions

PTY-backed terminal sessions enable direct interaction with the captain chat via a real terminal session using tmux. Sessions are persistent and shared between web UI and CLI access.

#### Create Terminal Session

```
POST /projects/:projectId/terminal
```

Creates a new terminal session running `claude --system-prompt-file` inside a tmux session. If a session already exists, returns the existing session.

**Response:** `200 OK`

```json
{
  "projectId": "uuid",
  "tmuxSessionName": "captain-abc12345",
  "createdAt": "ISO 8601"
}
```

**Error:** `404 Not Found` — Project does not exist.

**Error:** `500 Internal Server Error` — Failed to create tmux session.

**Side effects:**

- Creates tmux session named `captain-{projectId:0:8}`
- Spawns Claude CLI with captain system prompt
- Injects environment variables (`CREWDECK_*`, `GH_TOKEN`, SSH keys)
- Session persists until idle timeout (30 minutes) or manual termination

#### Get Terminal Session Status

```
GET /projects/:projectId/terminal
```

Returns the status of the terminal session for a project.

**Response:** `200 OK`

```json
{
  "exists": true,
  "projectId": "uuid",
  "tmuxSessionName": "captain-abc12345",
  "createdAt": "ISO 8601",
  "lastAccessedAt": "ISO 8601"
}
```

If no session exists:

```json
{
  "exists": false
}
```

#### Destroy Terminal Session

```
DELETE /projects/:projectId/terminal
```

Terminates the tmux session and cleans up temporary files (system prompt, SSH keys).

**Response:** `200 OK`

```json
{
  "destroyed": true
}
```

---

### Chat Threads

REST endpoints for chat thread CRUD and message sending. The Chat API only exposes user-created threads. Monitor threads (auto-created, one per project) exist in the database but are hidden from this API — they are managed internally by the monitor agent.

#### Create Thread

```
POST /projects/:projectId/chat/threads
```

Creates a new chat thread for a project.

**Request body:**

| Field | Type   | Required | Description                           |
| ----- | ------ | -------- | ------------------------------------- |
| title | string | No       | Thread title. NULL until renamed by user. |

**Response:** `201 Created` — The created `ChatThread` object.

#### List Threads

```
GET /projects/:projectId/chat/threads
```

Lists user chat threads for a project (monitor threads are excluded), enriched with message metadata.

**Response:** `200 OK` — Array of thread objects, each including:

| Extra field     | Type                    | Description                                       |
| --------------- | ----------------------- | ------------------------------------------------- |
| `last_message`  | `string \| null`        | Content text of the most recent message in the thread (or null). |
| `message_count` | number                  | Total number of messages in the thread.           |

#### Get Thread

```
GET /projects/:projectId/chat/threads/:threadId
```

Returns a single thread with its messages (paginated).

**Query Parameters:**

| Parameter | Type   | Default | Constraints    | Description                   |
| --------- | ------ | ------- | -------------- | ----------------------------- |
| limit     | number | 50      | Min 1, max 200 | Number of messages to return. |
| offset    | number | 0       | Min 0          | Number of messages to skip.   |

**Response:** `200 OK` — Thread object with a `messages` array.

**Error:** `404 NOT_FOUND` — Thread does not exist or belongs to a different project.

#### Update Thread

```
PATCH /projects/:projectId/chat/threads/:threadId
```

Updates a thread. The `title` field is user-editable. The `session_id` field can be set to `null` to start a fresh Claude session (preserving chat history).

**Request body:**

| Field      | Type            | Required | Description                                                         |
| ---------- | --------------- | -------- | ------------------------------------------------------------------- |
| title      | string          | No       | New thread title.                                                   |
| session_id | string or null  | No       | Set to `null` to clear the session and start a fresh Claude session. |

**Response:** `200 OK` — Updated thread object.

**Errors:**

- `404 NOT_FOUND` — Thread does not exist or belongs to a different project.
- `400 VALIDATION_ERROR` — No fields provided to update.

#### Delete Thread

```
DELETE /projects/:projectId/chat/threads/:threadId
```

Deletes a thread and all its messages. If Claude is actively streaming a response for this thread, the child process is terminated (SIGTERM) before rows are removed, preventing FK constraint errors.

**Response:** `200 OK`

```json
{ "deleted": true }
```

**Errors:**

- `404 NOT_FOUND` — Thread does not exist or belongs to a different project.

#### Send Message

```
POST /projects/:projectId/chat/threads/:threadId/messages
```

Sends a user message and triggers a Claude response. The endpoint returns immediately (fire-and-forget); the response is streamed in real-time via WebSocket events (see [Chat Events](#chat-events)). Only one message can be processed per thread at a time — concurrent sends return `409 CONFLICT`.

**Request body:**

| Field   | Type   | Required | Description                          |
| ------- | ------ | -------- | ------------------------------------ |
| content | string | Yes      | The user's message content.          |

**Response:** `202 Accepted`

```json
{ "message_id": "uuid" }
```

The HTTP response is returned immediately after saving the user message and acquiring the processing lock. The Claude session runs in the background. Use WebSocket events for real-time streaming and completion notification.

**Errors:**

- `404 NOT_FOUND` — Thread does not exist or belongs to a different project.
- `400 VALIDATION_ERROR` — Missing or invalid `content`.
- `409 CONFLICT` — A message is already being processed for this thread.
- `500` — Claude process failed (exit code 1, no content produced). `chat.error` WebSocket event is emitted with details.

**Side effects:**

- Saves user message to `ChatMessage` table before spawning Claude.
- Saves assistant response to `ChatMessage` table on completion.
- Updates thread's `updated_at` and `session_id` (captured from Claude CLI stream).
- Emits `chat.thinking`, `chat.message`, `chat.tool_call`, `chat.tool_result`, and `chat.complete` events on the event bus.
- Emits `chat.error` and `chat.complete` on failure.
- After the first successful reply in an untitled thread, fire-and-forget auto-generates a title via a lightweight Claude call (single-turn prompt requesting `<title>` XML tags). Extracts the title via regex from the XML tags, with 80-character truncation as a safety net. Emits `chat.thread_updated` on success. If auto-title generation fails, a fallback title is derived from the first 40 characters of the user's message and emitted via `chat.thread_updated`.
- If `--resume` fails (session expired), emits `chat.session_expired`, resets `session_id` to null, and starts a fresh session transparently.
- Configures SSH credentials from the project's VCS account (`GH_TOKEN`, `GIT_SSH_COMMAND`) so the captain can access private Git remotes and use the GitHub CLI. SSH key temp files are cleaned up when the session ends.
- If the Claude process fails (exit code 1, no content), emits `chat.error` with a user-friendly message, then `chat.complete`. No assistant message is saved.

#### Get Thread Status

```
GET /projects/:projectId/chat/threads/:threadId/status
```

Returns whether a thread is currently being processed by Claude. Use this to restore streaming state after page navigation.

**Response:** `200 OK`

```json
{ "active": true }
```

**Errors:**

- `404 NOT_FOUND` — Thread does not exist or belongs to a different project.

---

### Internal API

These endpoints are used by agent processes (`claude -p` subprocesses) spawned by the MentionHandler. They are not intended for frontend or external use. All internal endpoints require authentication (session cookie or API key) and enforce scope-based authorization. See [Agent Orchestration](agent-cli.md) for details on how agents are spawned and use these endpoints.

#### Post Comment (Internal)

```
POST /internal/comment
```

**Scope:** `internal:comment`

Agent posts a comment on an issue.

**Request Body:**

```json
{
  "issue_id": "uuid",
  "project_id": "uuid",
  "agent_id": "engineer",
  "content": "Fixed the bug, added tests"
}
```

| Field      | Required | Description                                                                |
| ---------- | -------- | -------------------------------------------------------------------------- |
| issue_id   | Yes      | The issue to comment on.                                                   |
| project_id | Yes      | The owning project.                                                        |
| agent_id   | No       | The agent's ID (e.g., `engineer`, `lead`). Used directly as `author_type`. |
| content    | Yes      | Comment body.                                                              |

**Response:** `201 Created`

**Side effects:** Emits `comment.added` on the event bus (which may trigger further `/dispatch` processing).

#### Create Issue (Internal)

```
POST /internal/issues/create
```

**Scope:** `internal:create-issue`

Agent creates a new issue. The issue is created with `created_by: "agent"`.

**Request Body:**

```json
{
  "project_id": "uuid",
  "title": "Fix authentication bug",
  "description": "The login endpoint returns 500 when..."
}
```

| Field       | Required | Description                         |
| ----------- | -------- | ----------------------------------- |
| project_id  | Yes      | The project to create the issue in. |
| title       | Yes      | Issue title (non-empty).            |
| description | Yes      | Issue description (non-empty).      |

**Response:** `201 Created` — The created issue object.

**Side effects:** Emits `issue.created` on the event bus.

#### List Knowledge Titles (Internal, Read-Only)

```
GET /internal/knowledge/titles?project_id=<uuid>
```

**Scope:** `internal:knowledge-read`

Agent lists knowledge entry titles for discovery. Available to all agents.

**Query Parameters:**

| Parameter  | Required | Description     |
| ---------- | -------- | --------------- |
| project_id | Yes      | The project ID. |

**Response:** `200 OK` — Array of lightweight objects with `id`, `title`, and `category`.

**Example Response:**

```json
[
  {
    "id": "uuid",
    "title": "API Conventions",
    "category": "conventions"
  }
]
```

#### Get Knowledge Entry (Internal, Read-Only)

```
GET /internal/knowledge/get?project_id=<uuid>&knowledge_id=<uuid>
```

**Scope:** `internal:knowledge-read`

Agent retrieves full content of a knowledge entry. Available to all agents.

**Query Parameters:**

| Parameter    | Required | Description     |
| ------------ | -------- | --------------- |
| project_id   | Yes      | The project ID. |
| knowledge_id | Yes      | The entry ID.   |

**Response:** `200 OK` — Full knowledge entry object.

**Error:** `404 Not Found` — Entry does not exist or belongs to a different project.

#### Create Knowledge Entry (Internal, Librarian Only)

```
POST /internal/knowledge/create
```

**Scope:** `internal:knowledge-write`

Agent creates a knowledge entry. The `source` field is automatically set to `librarian`.

**Request Body:**

```json
{
  "project_id": "uuid",
  "title": "API Conventions",
  "category": "conventions",
  "content": "All endpoints return JSON..."
}
```

| Field      | Required | Description                         |
| ---------- | -------- | ----------------------------------- |
| project_id | Yes      | The project to create the entry in. |
| title      | Yes      | Short title (non-empty).            |
| category   | Yes      | Category for grouping (non-empty).  |
| content    | Yes      | The knowledge content (non-empty).  |

**Response:** `201 Created` — The created knowledge entry object.

**Note:** The `source` field is forced to `librarian` for all entries created via this endpoint. This endpoint is only available to the librarian agent.

#### Update Knowledge Entry (Internal, Librarian Only)

```
POST /internal/knowledge/update
```

**Scope:** `internal:knowledge-write`

Agent updates a knowledge entry.

**Request Body:**

```json
{
  "project_id": "uuid",
  "knowledge_id": "uuid",
  "title": "Updated Title",
  "content": "Updated content..."
}
```

| Field        | Required | Description                     |
| ------------ | -------- | ------------------------------- |
| project_id   | Yes      | Must match the entry's project. |
| knowledge_id | Yes      | The entry to update.            |
| title        | No       | Updated title.                  |
| category     | No       | Updated category.               |
| content      | No       | Updated content.                |

**Response:** `200 OK` — The updated knowledge entry object.

**Error:** `404 Not Found` — Entry does not exist or belongs to a different project.

**Note:** This endpoint is only available to the librarian agent.

#### Delete Knowledge Entry (Internal, Librarian Only)

```
POST /internal/knowledge/delete
```

**Scope:** `internal:knowledge-write`

Agent deletes a knowledge entry.

**Request Body:**

```json
{
  "project_id": "uuid",
  "knowledge_id": "uuid"
}
```

| Field        | Required | Description                     |
| ------------ | -------- | ------------------------------- |
| project_id   | Yes      | Must match the entry's project. |
| knowledge_id | Yes      | The entry to delete.            |

**Response:** `204 No Content`

**Error:** `404 Not Found` — Entry does not exist or belongs to a different project.

**Note:** This endpoint is only available to the librarian agent.

#### Register PR (Internal)

```
POST /internal/create-pr
```

**Scope:** `internal:create-pr`

Agent registers a PR for tracking. This creates an `IssuePR` record linking the PR to the issue, enabling the PR poller to auto-transition the issue to `done` when the PR is merged.

**Request Body:**

```json
{
  "project_id": "uuid",
  "issue_id": "uuid",
  "pr_url": "https://github.com/owner/repo/pull/123"
}
```

| Field      | Required | Description                       |
| ---------- | -------- | --------------------------------- |
| project_id | Yes      | The project the issue belongs to. |
| issue_id   | Yes      | The issue to link the PR to.      |
| pr_url     | Yes      | Full GitHub PR URL.               |

**Response:**

`201 Created` — New IssuePR record created:

```json
{
  "id": "uuid",
  "issue_id": "uuid",
  "repo_id": "uuid",
  "pr_number": 123,
  "pr_url": "https://github.com/owner/repo/pull/123",
  "status": "open",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

`200 OK` — PR already linked (idempotent). Returns existing record.

**Error:** `404 Not Found` — Issue does not exist or does not belong to the project.

**Error:** `400 VALIDATION_ERROR` — Invalid PR URL format or PR URL does not match any repository linked to the project.

**Side effects:** Emits `pr.created` on the event bus.

#### Dispatch Agent (Captain)

```
POST /internal/captain/dispatch-agent
```

**Scope:** `internal:dispatch`

Dispatches an agent to work on an issue. Used by the Captain chat to spawn agents via curl. Validates the same gates as `/dispatch` commands (auto_start approval, paused-issue gate, chain depth, concurrency limit).

**Request Body:**

```json
{
  "project_id": "uuid",
  "issue_id": "uuid",
  "agent_id": "engineer",
  "instructions": "Focus on the database layer"
}
```

| Field        | Required | Description                                         |
| ------------ | -------- | --------------------------------------------------- |
| project_id   | Yes      | The project the issue belongs to.                   |
| issue_id     | Yes      | The issue to dispatch the agent on.                 |
| agent_id     | Yes      | The agent to spawn (e.g., `engineer`, `lead`, `docs`). |
| instructions | No       | Optional custom instructions appended to the prompt. |

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Agent engineer dispatched to issue <ISSUE_ID>"
}
```

**Error:** `400 VALIDATION_ERROR` — Missing required fields, issue is paused, auto_start disabled without approval, chain depth limit reached, or concurrency limit reached.

#### Merge PR (Captain)

```
POST /internal/captain/merge-pr
```

**Scope:** `internal:merge`

Merges a ready PR for an issue. Used by the Captain chat to merge PRs via curl. Enforces the same gates as the `/merge` command (auto_merge approval, paused-issue gate, CI gate — issue must be in `pr_ready_to_merge` status).

**Request Body:**

```json
{
  "project_id": "uuid",
  "issue_id": "uuid"
}
```

| Field      | Required | Description                       |
| ---------- | -------- | --------------------------------- |
| project_id | Yes      | The project the issue belongs to. |
| issue_id   | Yes      | The issue whose PR should be merged. |

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "PR merged for issue <ISSUE_ID>"
}
```

**Error:** `400 VALIDATION_ERROR` — Missing required fields, issue is paused, auto_merge disabled without approval, or issue not in `pr_ready_to_merge` status.

#### Scan Codebase (Captain)

```
POST /internal/captain/scan-codebase
```

**Scope:** `internal:scan`

Triggers a codebase scan that spawns the librarian agent to update project knowledge. Used by the Captain chat via curl. Equivalent to `POST /projects/:projectId/knowledge/scan` but accessed via the internal API with `project_id` in the request body.

**Request Body:**

```json
{
  "project_id": "uuid"
}
```

| Field      | Required | Description                       |
| ---------- | -------- | --------------------------------- |
| project_id | Yes      | The project to scan.              |

**Response:** `200 OK`

```json
{
  "success": true,
  "message": "Codebase scan started"
}
```

**Error:** `400 VALIDATION_ERROR` — Missing `project_id`.

**Side effects:** Creates an `AgentRun` record and spawns the librarian agent. Emits `run.started` event.

---

## Status Transition Rules

Issue status changes are validated to ensure a valid lifecycle. All status values and the transition map are defined centrally in `backend/src/constants/statuses.ts` (`IssueStatus`, `PRStatus`, `TRANSITIONS`):

| From              | Allowed Transitions                                                  |
| ----------------- | -------------------------------------------------------------------- |
| open              | in_progress, done                                                    |
| in_progress       | pr_created, done                                                     |
| pr_created        | in_progress, done, pr_conflict, pr_failed_actions, pr_ready_to_merge |
| pr_conflict       | pr_created, in_progress                                              |
| pr_failed_actions | pr_created, in_progress                                              |
| pr_ready_to_merge | done, pr_conflict, in_progress                                       |
| done              | (terminal — no further transitions)                                  |

Any status can transition to `done` via `PATCH /issues/:issueId` (rejected if active agent processes are running).

Dispatching an agent on any PR-related status (`pr_created`, `pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`) or `done` issue automatically regresses it to `in_progress` before the agent is spawned.

---

## WebSocket API

### Connection

```
ws://localhost:<port>/ws?projectId=<uuid>
```

Clients connect with a project ID to receive events scoped to that project. **Requires a valid session cookie** (`session_token`). The server validates the session before checking the project. Unauthenticated or invalid sessions receive `ws.close(4001, 'Unauthorized')`.

### Global Connection

```
ws://localhost:<port>/ws?global=true
```

Clients connect without a project ID to receive events from all projects. Used by the dashboard and sidebar via a shared `globalWs` singleton for real-time project stats, activity feed updates, and sidebar count updates. **Requires a valid session cookie** (`session_token`). Broadcasts all events except high-frequency `run.event` and monitor events. Unauthenticated or invalid sessions receive `ws.close(4001, 'Unauthorized')`.

### Terminal WebSocket Connection

```
ws://localhost:<port>/terminal-ws?projectId=<uuid>
```

Establishes a WebSocket connection for PTY streaming. **Requires a valid session cookie** (`session_token`). This is the most sensitive endpoint (direct shell access) — unauthenticated or invalid sessions receive `ws.close(4001, 'Unauthorized')`.

Connects to the project's tmux session and provides bidirectional I/O:

- **Server → Client**: Raw PTY output bytes (terminal escape sequences, text)
- **Client → Server**: Raw keyboard input or resize messages

**Resize message format:**

```json
{
  "type": "resize",
  "cols": 80,
  "rows": 24
}
```

Non-resize messages are treated as terminal input and written directly to the PTY.

### Type Safety

The frontend defines a `WsEventMap` interface in `frontend/src/lib/api/types.ts` that maps every event name to its typed payload. `ProjectWebSocket.on()` uses generic overloads so handlers receive fully typed `data` parameters with IDE autocomplete — no manual casting required.

Global WebSocket subscribers use a `GlobalWsEventMap` interface — a subset of `WsEventMap` that excludes `run.event` and monitor events (to avoid flooding consumers with high-frequency data). A module-level `globalWs` singleton (`frontend/src/lib/api/global-ws.svelte.ts`) is shared across the dashboard and sidebar. The `GlobalWebSocket` class uses the same typed `on()` pattern as `ProjectWebSocket`.

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

All events below (except `run.event` and monitor events) are broadcast to both per-project subscribers and global subscribers. The `run.event` stream is only sent to per-project subscribers.

#### Issue Events

| Event                  | Description                                                                                                              | Data                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `issue.created`        | New issue created                                                                                                        | `{ issue: Issue }`                                           |
| `issue.updated`        | Issue fields changed                                                                                                     | `{ issue_id, project_id, changes }`                          |
| `issue.status_changed` | Status transition (triggers automatic worktree cleanup and dependency removal when `to === "done"` — DB fields always cleared in finally block) | `{ issue_id, project_id, from, to, actor_type?, actor_id? }` |
| `issue.paused`         | Issue paused                                                                                                             | `{ issue_id, project_id }`                                   |
| `issue.resumed`        | Issue resumed                                                                                                            | `{ issue_id, project_id }`                                   |

#### Comment Events

| Event             | Description              | Data                                   |
| ----------------- | ------------------------ | -------------------------------------- |
| `comment.added`   | New comment on an issue  | `{ comment, project_id }`              |
| `comment.updated` | User comment was edited  | `{ comment, project_id }`              |
| `comment.deleted` | User comment was deleted | `{ comment_id, issue_id, project_id }` |

#### Dispatch Events

| Event                         | Description                                                               | Data                                                                       |
| ----------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `mention.spawned`             | Agent process started for a /dispatch command                             | `{ project_id, issue_id, agent_id, agent_name?, issue_title?, pid }`       |
| `mention.completed`           | Agent process finished                                                    | `{ project_id, issue_id, agent_id, agent_name?, issue_title?, exit_code }` |
| `mention.error`               | Agent process failed                                                      | `{ project_id, issue_id, agent_id, agent_name?, issue_title?, message }`   |
| `mention.chain_depth_reached` | Issue chain depth limit reached (global `max_chain_depth` setting) | `{ project_id, issue_id, issue_title? }`                                   |
| `dispatch.queued`             | Agent dispatch queued (concurrency limit reached)                         | `{ project_id, issue_id, agent_id, agent_name?, issue_title?, position }`  |
| `dispatch.dequeued`           | Agent dispatch dequeued and starting                                      | `{ project_id, issue_id, agent_id, agent_name?, issue_title? }`            |

#### Agent Run Events

| Event           | Description                             | Data                                                                                                                    |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `run.started`   | Agent run started (process spawned)     | `{ agent_run_id, project_id, issue_id, agent_id, agent_name?, status, started_at }`                                     |
| `run.event`     | Streamed event received from Claude CLI (per-project only, not broadcast to global subscribers) | `{ agent_run_id, project_id, event_id, type, data, created_at }` — `data` is normalized (see Agent Runs)                |
| `run.completed` | Agent run finished                      | `{ agent_run_id, project_id, issue_id, agent_id, agent_name?, status, exit_code, cost_usd, duration_ms, completed_at }` |

#### PR Events

| Event               | Description             | Data                              |
| ------------------- | ----------------------- | --------------------------------- |
| `pr.created`        | PR recorded on an issue | `{ issue_pr, project_id }`        |
| `pr.status_changed` | PR status updated       | `{ pr_id, project_id, from, to }` |

#### Chat Events

| Event                    | Description                                 | Data                                                                  |
| ------------------------ | ------------------------------------------- | --------------------------------------------------------------------- |
| `chat.thinking`          | Captain is analyzing (dual-emitted)         | `{ project_id, thread_id }`                                          |
| `chat.message`           | Assistant text chunk streamed               | `{ project_id, thread_id, content }`                                 |
| `chat.tool_call`         | Tool usage by Claude during chat            | `{ project_id, thread_id, tool_name, tool_input }`                   |
| `chat.tool_result`       | Tool result received during chat            | `{ project_id, thread_id, tool_name, result, success }`              |
| `chat.complete`          | Chat response finished                      | `{ project_id, thread_id, message_id? }`                             |
| `chat.error`             | Claude process failed                       | `{ project_id, thread_id, error }`                                   |
| `chat.session_expired`   | Claude session expired, new one started     | `{ project_id, thread_id }`                                          |
| `chat.thread_updated`    | Thread title updated                        | `{ project_id, thread_id, title }`                                   |

#### Project Events

Project events are broadcast to **all connected clients** via the global WebSocket, so any connection receives them regardless of which project it is subscribed to.

| Event                      | Description               | Data                    |
| -------------------------- | ------------------------- | ----------------------- |
| `project.settings_changed` | Project settings modified | `{ project_id, changes }` |
| `project.created`          | New project created       | `{ project }` — full Project object |
| `project.deleted`          | Project deleted           | `{ project_id }`        |

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

| Code               | HTTP Status | Description                                                                           |
| ------------------ | ----------- | ------------------------------------------------------------------------------------- |
| NOT_FOUND          | 404         | Resource does not exist.                                                              |
| VALIDATION_ERROR   | 400         | Request body fails validation.                                                        |
| INVALID_TRANSITION | 400         | Invalid status transition.                                                            |
| CONFLICT           | 409         | Operation conflicts with current state (e.g., marking done while agents are running). |
| FORBIDDEN          | 403         | Action not allowed — insufficient permissions.                                        |
| INTERNAL_ERROR     | 500         | Unexpected server error.                                                              |
