---
title: CrewDeck API Specification
version: 0.3.0
status: draft
---

# CrewDeck — API Specification

## Overview

The backend exposes a REST API for CRUD operations and a WebSocket server for real-time events. All REST endpoints return JSON. All request bodies are JSON.

**Base URL:** `http://localhost:<port>/api/v1`

**Health check:** `GET /health` returns `{ "status": "ok" }` (outside the `/api/v1` prefix).

**Configuration:** Port and other settings are configured via environment variables (`.env` file).

**Validation:** All request bodies are validated with Zod schemas. Issue and PR status fields are validated as enums against the centralized status constants defined in `backend/src/constants/statuses.ts`. Invalid requests return a `VALIDATION_ERROR` response.

## REST API

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
    "max_concurrency": 3,
    "max_chain_depth": 20,
    "auto_start": false,
    "auto_merge": false,
    "github_account_id": "uuid | null",
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
    "max_chain_depth": 20,
    "auto_start": false,
    "auto_merge": false,
    "github_account_id": "uuid | null",
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
    }
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

| Field             | Required | Default                          | Description                                                                |
| ----------------- | -------- | -------------------------------- | -------------------------------------------------------------------------- |
| github_url        | Yes      | —                                | GitHub URL of the repository to link to this project.                      |
| name              | No       | Repo name from GitHub API        | Project name.                                                              |
| description       | No       | Repo description from GitHub API | Project description.                                                       |
| max_concurrency   | No       | —                                | Max concurrent agent processes.                                            |
| github_account_id | No       | null                             | ID of a connected GitHubAccount to use for git operations in this project. |

**Response:** `201 Created` — The created project object.

**Error:** `400 VALIDATION_ERROR` — If `github_url` is invalid or the repository cannot be cloned.

**Side effects:** The backend fetches repo metadata (name, description, default branch) from the GitHub API and clones the repository. If `github_account_id` is provided, the token is used for the API call and git operations; otherwise metadata is fetched unauthenticated with a fallback to URL-derived values on failure.

#### Update Project

```
PATCH /projects/:id
```

**Request Body:** Any subset of project fields (name, description, max_concurrency, max_chain_depth, auto_start, auto_merge, github_account_id).

**Response:** `200 OK` — The updated project object.

#### Delete Project

```
DELETE /projects/:id
```

**Response:** `204 No Content`

**Side effects:** Kills any active agent processes, cleans up worktrees, deletes all related data (cascading).

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

| Field     | Required | Description                           |
| --------- | -------- | ------------------------------------- |
| client_id | No       | Overrides `GITHUB_CLIENT_ID` env var. |

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

#### List GitHub Accounts

```
GET /github-accounts
```

**Response:** `200 OK` — Array of GitHubAccount objects (without `oauth_token`).

#### Delete GitHub Account

```
DELETE /github-accounts/:id
```

Disconnects the account. Best-effort token revocation is attempted (requires both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`).

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

| Field          | Required | Default | Description                                           |
| -------------- | -------- | ------- | ----------------------------------------------------- |
| github_url     | Yes      | —       | Full GitHub URL. Name and owner are parsed from this. |
| default_branch | No       | main    | Default branch name.                                  |

**Response:** `201 Created` — The created repo object.

**Side effects:** The backend clones the repo to a managed directory if not already present. Uses the project's linked GitHub account token when available.

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

### Crew / Agents

The crew is a fixed set of 5 global agents (engineer, lead, docs, librarian, captain). These are hardcoded and immutable. Both `/crew` and `/agents` return the same data, excluding non-dispatchable agents like Captain.

#### List Crew

```
GET /crew
GET /agents
```

Both paths return the dispatchable agents (4 agents). Captain is excluded because it is a background service, not a dispatchable agent. The `/crew` path is canonical; `/agents` is kept for compatibility.

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

| Field         | Type    | Description                                                                                                                                                     |
| ------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id            | TEXT    | Agent identifier.                                                                                                                                               |
| name          | TEXT    | Display name.                                                                                                                                                   |
| title         | TEXT    | Agent role title.                                                                                                                                               |
| description   | TEXT    | Brief description of the agent's purpose.                                                                                                                       |
| system_prompt | TEXT    | System prompt injected into agent processes.                                                                                                                    |
| dispatchable  | BOOLEAN | Whether this agent can be dispatched via `/dispatch`. Default: true. Background services (e.g., Captain) have this set to false and are excluded from the list. |

---

### Issues

#### List Issues for a Project

```
GET /projects/:projectId/issues
```

**Query Parameters:**

| Parameter  | Type | Description                                                                |
| ---------- | ---- | -------------------------------------------------------------------------- |
| status     | TEXT | Filter by status. Comma-separated for multiple (e.g., `open,in_progress`). |
| created_by | TEXT | Filter by creator (`user`, `agent`, or `system`).                          |
| sort       | TEXT | Sort field. One of: `created_at`, `updated_at`. Default: `created_at`.     |
| order      | TEXT | Sort order. `asc` or `desc`. Default: `desc`.                              |

**Response:** `200 OK` — Array of issue objects (without full comment thread). Each issue includes `running_agent_id` and `running_agent_status` fields indicating the currently running or queued agent (if any).

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "title": "Fix authentication bug",
    "status": "in_progress",
    "running_agent_id": "engineer",
    "running_agent_status": "running",
    "...": "..."
  }
]
```

- `running_agent_id`: The ID of the agent currently running or queued on this issue. NULL if no agent is active.
- `running_agent_status`: Either `"running"` or `"queued"`. NULL if no agent is active.

#### Get Issue

```
GET /projects/:projectId/issues/:issueId
```

**Response:** `200 OK` — Full issue object including comments, linked PRs, and activity log.

```json
{
  "id": "uuid",
  "project_id": "uuid",
  "title": "Fix authentication bug",
  "description": "...",
  "status": "in_progress",
  "created_by": "user",
  "chain_depth": 2,
  "branch_name": "crewdeck/issue-uuid-short",
  "worktree_path": "/path/to/worktree",
  "base_branch": "main",
  "repo_id": "uuid",
  "repo": { "id": "uuid", "name": "repo" },
  "comments": [...],
  "issue_prs": [...],
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

**Note:** Status changes are validated against the transition rules (see Status Transitions below). Transitioning to `done` is rejected if active agent processes are running on the issue (excluding the agent specified in `X-Agent-ID`). Set `chain_depth: 0` to reset the `/dispatch` chain depth counter after the project's `max_chain_depth` limit is reached.

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
```

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

Event `type` values are strings from Claude CLI stream-json output (e.g., `assistant`, `user`, `tool_use`, `tool_result`, `result`, `system`, `error`). Events are **normalized** on retrieval — the nested Claude CLI format (`message.content[]` arrays) is flattened into a simpler structure:

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

**Response:** `200 OK` — Array of activity log entries, ordered by created_at descending. Entries where `actor_type` is `agent` include an additional `actor_name` field (string) with the agent's display name.

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
    "agent_ids": ["engineer", "lead"],
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
  "source": "user",
  "agent_ids": ["engineer", "lead"]
}
```

| Field     | Required | Default | Description                                                             |
| --------- | -------- | ------- | ----------------------------------------------------------------------- |
| title     | Yes      | —       | Short title for the entry.                                              |
| category  | Yes      | —       | Category for grouping (e.g., `architecture`, `conventions`, `gotchas`). |
| content   | Yes      | —       | The knowledge content.                                                  |
| source    | No       | null    | Optional source reference (e.g., `user`, `librarian`, file path, URL).  |
| agent_ids | No       | null    | Array of agent IDs this entry applies to. NULL means all agents.        |

**Response:** `201 Created` — The created knowledge entry object.

**Error:** `404 Not Found` — Project does not exist.

#### Update Knowledge Entry

```
PATCH /projects/:projectId/knowledge/:knowledgeId
```

**Request Body:** Any subset of fields (title, category, content, source, agent_ids).

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

**Error:** `500 Internal Server Error` — If the project's concurrency limit is reached (scans cannot be queued).

**Side effects:**

- Creates an `AgentRun` record with `issue_id: null`.
- Spawns the librarian agent process.
- Emits `run.started` event.

---

### Chat Sessions

Session-based conversational interface to the Captain. Each project can have one active session at a time. Creating a new session atomically archives the current active one.

#### List Sessions

```
GET /projects/:projectId/chat/sessions
```

Returns all chat sessions for the project, newest first.

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "title": "Session title or null",
    "summary": null,
    "status": "active",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
]
```

#### Create Session

```
POST /projects/:projectId/chat/sessions
```

Creates a new chat session. If an active session exists, it is archived atomically.

**Request Body:**

```json
{
  "title": "Optional session title"
}
```

| Field | Required | Description                         |
| ----- | -------- | ----------------------------------- |
| title | No       | Session title (max 200 characters). |

**Response:** `201 Created` — The created session object.

#### Get Session Messages

```
GET /projects/:projectId/chat/sessions/:sessionId/messages
```

Returns all messages in a session, in chronological order.

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "session_id": "uuid",
    "role": "user",
    "content": "Message text",
    "images": null,
    "created_at": "ISO 8601"
  }
]
```

**Error:** `404 Not Found` — Session does not exist or does not belong to the project.

#### Send Message

```
POST /projects/:projectId/chat/sessions/:sessionId/messages
```

Sends a message in a session, which triggers a Captain response via `claude -p`. The response is delivered asynchronously via WebSocket `captain.chat.chunk`, `captain.chat.tool_call`, `captain.chat.tool_result`, and `captain.chat.complete` events. Legacy `chat.stream` and `chat.complete` events are also emitted for backward compatibility.

**Request Body:**

```json
{
  "message": "Your message text",
  "images": [{ "data": "base64...", "mediaType": "image/png" }]
}
```

| Field   | Required | Description                                     |
| ------- | -------- | ----------------------------------------------- |
| message | Yes      | Message content (non-empty).                    |
| images  | No       | Array of base64-encoded images with media type. |

**Response:** `202 Accepted` — Message queued for Captain processing.

```json
{
  "user_message": {
    "id": "uuid",
    "project_id": "uuid",
    "session_id": "uuid",
    "role": "user",
    "content": "...",
    "images": null,
    "created_at": "ISO 8601"
  },
  "status": "queued"
}
```

**Error:** `404 Not Found` — Session does not exist or does not belong to the project.

**Error:** `400 SESSION_ARCHIVED` — Cannot add messages to an archived session.

**Error:** `409 SESSION_BUSY` — Session already has an in-flight message. Wait for completion or abort.

**Side effects:** Emits `chat.message` event with `session_id` for Captain processing.

#### Abort In-Flight Message

```
POST /projects/:projectId/chat/sessions/:sessionId/abort
```

Aborts the in-flight message for a session. The spawned `claude -p` process is killed (SIGTERM → SIGKILL after 5s) and the partial response is discarded (not saved to DB).

**Response:** `200 OK`

```json
{
  "status": "abort_requested"
}
```

**Error:** `404 Not Found` — Session does not exist or does not belong to the project.

**Side effects:** Emits `chat.abort` event. The Chat service kills the in-flight process and discards partial output.

#### Clear Chat History

```
DELETE /projects/:projectId/chat
```

Deletes all chat messages for the project. Kept for backward compatibility.

**Response:** `204 No Content`

---

### Monitor

#### Get Monitor History

```
GET /projects/:projectId/monitor/history
GET /projects/:projectId/monitor/history?limit=50
```

Returns stored monitor messages (ChatMessage records with `session_id = null`), sorted chronologically (oldest first). Used by the Monitor panel to load history on mount.

**Query Parameters:**

| Parameter | Type    | Description                                     |
| --------- | ------- | ----------------------------------------------- |
| limit     | INTEGER | Max messages to return. Default: 100. Max: 500. |

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "session_id": null,
    "role": "user",
    "content": "Event batch: issue.created, run.completed",
    "images": null,
    "created_at": "ISO 8601"
  },
  {
    "id": "uuid",
    "project_id": "uuid",
    "session_id": null,
    "role": "assistant",
    "content": "I'll dispatch the engineer to work on the new issue.",
    "images": null,
    "created_at": "ISO 8601"
  }
]
```

**Error:** `404 Not Found` — Project does not exist.

---

### Internal API

These endpoints are used by agent processes (`claude -p` subprocesses) spawned by the MentionHandler. They are not intended for frontend or external use. See [Agent Orchestration](agent-cli.md) for details on how agents are spawned and use these endpoints.

#### Post Comment (Internal)

```
POST /internal/comment
```

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

#### List Knowledge Entries (Internal)

```
GET /internal/knowledge/list?project_id=<uuid>
```

Agent lists all knowledge entries for a project.

**Query Parameters:**

| Parameter  | Required | Description     |
| ---------- | -------- | --------------- |
| project_id | Yes      | The project ID. |

**Response:** `200 OK` — Array of knowledge entry objects.

#### Create Knowledge Entry (Internal)

```
POST /internal/knowledge/create
```

Agent creates a knowledge entry. The `source` field is automatically set to `librarian`.

**Request Body:**

```json
{
  "project_id": "uuid",
  "title": "API Conventions",
  "category": "conventions",
  "content": "All endpoints return JSON...",
  "agent_ids": ["engineer", "lead"]
}
```

| Field      | Required | Description                                                      |
| ---------- | -------- | ---------------------------------------------------------------- |
| project_id | Yes      | The project to create the entry in.                              |
| title      | Yes      | Short title (non-empty).                                         |
| category   | Yes      | Category for grouping (non-empty).                               |
| content    | Yes      | The knowledge content (non-empty).                               |
| agent_ids  | No       | Array of agent IDs this entry applies to. NULL means all agents. |

**Response:** `201 Created` — The created knowledge entry object.

**Note:** The `source` field is forced to `librarian` for all entries created via this endpoint.

#### Update Knowledge Entry (Internal)

```
POST /internal/knowledge/update
```

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
| agent_ids    | No       | Updated agent assignments.      |

**Response:** `200 OK` — The updated knowledge entry object.

**Error:** `404 Not Found` — Entry does not exist or belongs to a different project.

#### Delete Knowledge Entry (Internal)

```
POST /internal/knowledge/delete
```

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

#### Register PR (Internal)

```
POST /internal/create-pr
```

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

#### Dispatch Agent (Internal)

```
POST /internal/captain/dispatch-agent
```

Dispatches an agent to work on an issue. This is used by the orchestration tool handler — the frontend does not call this endpoint.

**Request Body:**

```json
{
  "project_id": "uuid",
  "issue_id": "uuid",
  "agent_id": "engineer",
  "instructions": "Optional instructions for the agent"
}
```

| Field        | Required | Description                                                             |
| ------------ | -------- | ----------------------------------------------------------------------- |
| project_id   | Yes      | The project the issue belongs to.                                       |
| issue_id     | Yes      | The issue to dispatch the agent on.                                     |
| agent_id     | Yes      | The agent to dispatch. One of: `engineer`, `lead`, `docs`, `librarian`. |
| instructions | No       | Optional instructions posted as a system comment before spawning.       |

**Response:** `200 OK` — ToolResult object with success status and message.

```json
{
  "success": true,
  "message": "Dispatched engineer on issue abc123"
}
```

**Error:** `400 VALIDATION_ERROR` — Invalid agent_id (must be engineer, lead, docs, or librarian).

**Side effects:**

- Posts a system comment with instructions (if provided).
- Spawns the specified agent process.
- Emits `run.started` event.

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

Clients connect with a project ID to receive events scoped to that project. The server validates that the project exists on connection.

### Type Safety

The frontend defines a `WsEventMap` interface in `frontend/src/lib/api/types.ts` that maps every event name to its typed payload. `ProjectWebSocket.on()` uses generic overloads so handlers receive fully typed `data` parameters with IDE autocomplete — no manual casting required.

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

| Event                  | Description          | Data                                                         |
| ---------------------- | -------------------- | ------------------------------------------------------------ |
| `issue.created`        | New issue created    | `{ issue }` — full Issue object                              |
| `issue.updated`        | Issue fields changed | `{ issue_id, project_id, changes }`                          |
| `issue.status_changed` | Status transition    | `{ issue_id, project_id, from, to, actor_type?, actor_id? }` |

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
| `mention.chain_depth_reached` | Issue chain depth limit reached (per project's `max_chain_depth` setting) | `{ project_id, issue_id, issue_title? }`                                   |
| `dispatch.queued`             | Agent dispatch queued (concurrency limit reached)                         | `{ project_id, issue_id, agent_id, position }`                             |
| `dispatch.dequeued`           | Agent dispatch dequeued and starting                                      | `{ project_id, issue_id, agent_id }`                                       |

#### Agent Run Events

| Event           | Description                             | Data                                                                                                       |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `run.started`   | Agent run started (process spawned)     | `{ agent_run_id, project_id, issue_id, agent_id, status, started_at }`                                     |
| `run.event`     | Streamed event received from Claude CLI | `{ agent_run_id, project_id, event_id, type, data, created_at }` — `data` is normalized (see Agent Runs)   |
| `run.completed` | Agent run finished                      | `{ agent_run_id, project_id, issue_id, agent_id, status, exit_code, cost_usd, duration_ms, completed_at }` |

#### PR Events

| Event               | Description             | Data                              |
| ------------------- | ----------------------- | --------------------------------- |
| `pr.created`        | PR recorded on an issue | `{ issue_pr, project_id }`        |
| `pr.status_changed` | PR status updated       | `{ pr_id, project_id, from, to }` |

#### Captain Events (Chat)

| Event                      | Description                            | Data                                                |
| -------------------------- | -------------------------------------- | --------------------------------------------------- |
| `captain.thinking`         | Captain chat is processing a message   | `{ project_id }`                                    |
| `captain.message`          | Captain chat text response (legacy)    | `{ project_id, content }`                           |
| `captain.complete`         | Captain chat finished processing       | `{ project_id, response }`                          |
| `captain.chat.chunk`       | Streaming text chunk from Chat service | `{ project_id, session_id, text }`                  |
| `captain.chat.tool_call`   | Chat invoked a tool during response    | `{ project_id, session_id, tool_name, tool_input }` |
| `captain.chat.tool_result` | Chat tool execution completed          | `{ project_id, session_id, tool_name, result }`     |
| `captain.chat.complete`    | Chat response finished, message saved  | `{ project_id, session_id, message_id }`            |

#### Monitor Events

| Event                    | Description                                | Data                                      |
| ------------------------ | ------------------------------------------ | ----------------------------------------- |
| `monitor.event_received` | Monitor received a system event to process | `{ project_id, event_type, description }` |
| `monitor.thinking`       | Monitor is processing events               | `{ project_id }`                          |
| `monitor.message`        | Monitor text response                      | `{ project_id, content }`                 |
| `monitor.tool_call`      | Monitor invoked a tool                     | `{ project_id, tool_name, tool_input }`   |
| `monitor.tool_result`    | Monitor tool execution completed           | `{ project_id, tool_name, result }`       |
| `monitor.complete`       | Monitor finished processing                | `{ project_id, response }`                |

#### Project Events

| Event                      | Description               | Data          |
| -------------------------- | ------------------------- | ------------- |
| `project.settings_changed` | Project settings modified | `{ changes }` |

#### Chat Events (Legacy)

These events are emitted for backward compatibility. Prefer the `captain.chat.*` events above.

| Event           | Description                               | Data                         |
| --------------- | ----------------------------------------- | ---------------------------- |
| `chat.stream`   | Token streamed from Chat service (legacy) | `{ project_id, token }`      |
| `chat.complete` | Chat service finished processing (legacy) | `{ project_id, message_id }` |

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
| SESSION_ARCHIVED   | 400         | Cannot add messages to an archived chat session.                                      |
| SESSION_BUSY       | 409         | Session already has an in-flight message. Wait for completion or abort.               |
| CONFLICT           | 409         | Operation conflicts with current state (e.g., marking done while agents are running). |
| FORBIDDEN          | 403         | Action not allowed (e.g., editing agent comments).                                    |
| INTERNAL_ERROR     | 500         | Unexpected server error.                                                              |
