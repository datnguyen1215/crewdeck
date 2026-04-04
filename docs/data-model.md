---
title: CrewDeck Data Model
version: 0.3.0
status: draft
---

# CrewDeck — Data Model

## Overview

All persistent state is stored in a local SQLite database. This document defines every entity, its fields, relationships, and constraints.

## Entity Relationship Diagram

```
┌────────────┐    ┌──────────┐       ┌──────────┐
│ VCSAccount │0──N│ Project  │1────N│   Repo   │
└────────────┘    └──────────┘       └──────────┘

┌──────────┐       ┌──────────┐       ┌──────────────┐
│  Issue   │1────N│ Comment  │       │ Activity Log │
└──────────┘       └──────────┘       └──────────────┘
     │1                                    │N
     │                                     │
     │N                                    │1
┌──────────────┐                      ┌──────────┐
│   IssuePR    │                      │  Issue   │
└──────────────┘                      └──────────┘

┌──────────┐       ┌─────────────────┐
│  Issue   │1────N│ IssueDependency │N────1│  Issue   │
└──────────┘       └─────────────────┘       └──────────┘

┌──────────┐       ┌──────────┐       ┌────────────────┐
│  Issue   │1────N│ AgentRun │1────N│ AgentRunEvent  │
└──────────┘       └──────────┘       └────────────────┘

┌──────────┐       ┌────────────────┐
│ Project  │1────N│ MonitorMessage │
└──────────┘       └────────────────┘

┌──────────┐       ┌─────────────┐       ┌─────────────┐
│ Project  │1────N│ ChatThread  │1────N│ ChatMessage │
└──────────┘       └─────────────┘       └─────────────┘

┌───────────┐1────N┌─────────┐
│ AdminUser │      │ Session │
└───────────┘      └─────────┘

┌─────────┐
│ ApiKey  │
└─────────┘
```

## Worktree Management

CrewDeck uses git worktrees to isolate concurrent work:

- **Issue worktrees**: Each issue gets its own worktree (path stored in `Issue.worktree_path`, branch in `Issue.branch_name`). Cleaned up when status reaches `done`.
- **Captain worktrees**: Each project's Captain Chat terminal runs in a long-lived worktree (named `captain/<project-slug>`). Worktree path is stored on the `TerminalSession` object (in-memory, not persisted to DB). These worktrees persist across terminal reconnects.

## Entities

### Project

Represents a body of work tied to one or more GitHub repositories.

| Field                    | Type        | Constraints                                               | Description                                                                                                                                 |
| ------------------------ | ----------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| id                       | TEXT (UUID) | PRIMARY KEY                                               | Unique identifier.                                                                                                                          |
| name                     | TEXT        | NOT NULL                                                  | Human-readable project name.                                                                                                                |
| description              | TEXT        |                                                           | Optional project description.                                                                                                               |
| vcs_account_id           | TEXT        | FOREIGN KEY → VCSAccount.id, NULLABLE, ON DELETE SET NULL | VCS account used for cloning repos and agent git operations.                                                                                |
| auto_start               | INTEGER     | NOT NULL, DEFAULT 0                                       | Whether Captain automatically starts work on new issues. Stored as 0/1; exposed as boolean in API.                                          |
| auto_merge               | INTEGER     | NOT NULL, DEFAULT 0                                       | Whether Captain automatically merges ready PRs. Stored as 0/1; exposed as boolean in API.                                                   |
| captain_status           | TEXT        | NOT NULL, DEFAULT 'idle'                                  | Current captain monitor phase. One of: `idle`, `receiving`, `thinking`, `executing`.                                                        |
| captain_status_detail    | TEXT        | NULLABLE                                                  | Human-readable detail for the current phase (e.g. "Analyzing 3 events", "Dispatching agent for issue X"). NULL when idle.                   |
| captain_pending_count    | INTEGER     | NOT NULL, DEFAULT 0                                       | Number of events queued for the captain monitor to process.                                                                                 |
| captain_processing_since | DATETIME    | NULLABLE                                                  | UTC timestamp when the current processing cycle started. NULL when idle.                                                                    |
| default_base_branch      | TEXT        | NOT NULL, DEFAULT 'main'                                  | Default base branch for this project. Used to populate `Issue.base_branch` at creation time and as the start point for captain worktrees. Falls back to `repo.default_branch` if unset. Configurable via Project Settings. |
| created_at               | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                       |                                                                                                                                             |
| memory                   | TEXT        |                                                           | Legacy field for project memory/notes. Superseded by ProjectKnowledge.                                                                      |
| updated_at               | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                       |                                                                                                                                             |

### VCSAccount

A VCS account (GitHub, GitLab, etc.) connected via Device Flow OAuth.

| Field        | Type        | Constraints                         | Description                                          |
| ------------ | ----------- | ----------------------------------- | ---------------------------------------------------- |
| id           | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                   |
| provider     | TEXT        | NOT NULL, DEFAULT 'github'          | VCS provider (e.g., 'github', 'gitlab').             |
| account_name | TEXT        | NOT NULL                            | Display name for the account (matches username).     |
| username     | TEXT        | NOT NULL                            | Username on the VCS provider.                        |
| token        | TEXT        | NOT NULL                            | OAuth/API access token. Never returned to client.    |
| scopes       | TEXT        |                                     | Comma-separated OAuth scopes granted (if supported). |
| created_at   | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                      |

**Note:** `token` is stored server-side only and stripped from all API responses.

---

### Repo

A VCS repository linked to a project.

| Field          | Type        | Constraints                         | Description                                                                                                         |
| -------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| id             | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                                                  |
| project_id     | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                                                     |
| repo_url       | TEXT        | NOT NULL                            | Full repository URL (e.g., `https://github.com/org/repo`).                                                          |
| name           | TEXT        | NOT NULL                            | Repository name (e.g., `repo`).                                                                                     |
| owner          | TEXT        | NOT NULL                            | Repository owner (e.g., `org`).                                                                                     |
| local_path     | TEXT        | NOT NULL                            | Absolute path to the local clone on disk. Managed by the backend; derived from `CREWDECK_REPOS_DIR/<owner>/<name>`. |
| default_branch | TEXT        | NOT NULL, DEFAULT 'main'            | Default branch name.                                                                                                |
| created_at     | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                                                     |

**Constraints:**

- UNIQUE(project_id, repo_url) — a repo can only be linked once per project.

### Issue

The fundamental unit of work.

| Field         | Type        | Constraints                         | Description                                                                                                                                                                                                                                                        |
| ------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id            | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                                                                                                                                                                                                 |
| project_id    | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                                                                                                                                                                                                    |
| title         | TEXT        | NOT NULL                            | Issue title.                                                                                                                                                                                                                                                       |
| description   | TEXT        | NOT NULL                            | Detailed issue description.                                                                                                                                                                                                                                        |
| status        | TEXT        | NOT NULL, DEFAULT 'open'            | Current status. One of: `open`, `in_progress`, `pr_created`, `pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`, `done`.                                                                                                                                      |
| paused        | INTEGER     | NOT NULL, DEFAULT 0                 | Whether the issue is paused. Stored as 0/1; exposed as boolean in API.                                                                                                                                                                                             |
| created_by    | TEXT        | NOT NULL, DEFAULT 'user'            | Who created the issue. One of: `user`, `system`.                                                                                                                                                                                                                   |
| chain_depth   | INTEGER     | NOT NULL, DEFAULT 0                 | Number of agent spawns on this issue. Capped at the global `max_chain_depth` setting.                                                                                                                                                                                         |
| branch_name   | TEXT        | NULLABLE                            | Git branch where work is being done.                                                                                                                                                                                                                               |
| worktree_path | TEXT        | NULLABLE                            | Absolute path to the git worktree.                                                                                                                                                                                                                                 |
| base_branch   | TEXT        | NULLABLE                            | The branch this issue's PR targets. Resolved once at creation time: explicit value → `project.default_base_branch` → `"main"`. Backfilled to `"main"` for pre-existing issues. Editable while status is `open`; locked once work starts (`in_progress` or beyond). |
| repo_id       | TEXT        | FOREIGN KEY → Repo.id, NULLABLE     | The repo this issue is being worked on in.                                                                                                                                                                                                                         |
| agent_id      | TEXT        | NULLABLE                            | The agent currently assigned to this issue. One of the fixed agent IDs (engineer, lead, docs, librarian) or NULL if unassigned.                                                                                                                                    |
| created_at    | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                                                                                                                                                                                                    |
| updated_at    | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                                                                                                                                                                                                    |

**Note:** When listing issues via the API (`GET /projects/:projectId/issues`), the response is paginated and includes `issues`, `total`, `limit`, and `offset` fields. Results are paginated with a default limit of 50 and max of 100. When no `status` filter is provided, `done` issues are excluded by default. Each issue is returned with additional computed fields: `running_agent_id` and `running_agent_status` (derived from a LEFT JOIN on `AgentRun`), and `dependencies` and `dependents` arrays (each containing `{ id, title, status }` summaries, batch-fetched from `IssueDependency`). The detail endpoint (`GET /projects/:projectId/issues/:issueId`) also includes these arrays.

### Comment

A message on an issue from an agent, the system, or a human.

| Field       | Type        | Constraints                         | Description                                                                                  |
| ----------- | ----------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| id          | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                           |
| issue_id    | TEXT        | NOT NULL, FOREIGN KEY → Issue.id    | The issue this comment belongs to.                                                           |
| author_type | TEXT        | NOT NULL                            | Who posted it. One of: `user`, `system`, `captain`, `engineer`, `lead`, `docs`, `librarian`. |
| content     | TEXT        | NOT NULL                            | Comment body (Markdown supported).                                                           |
| created_at  | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                              |

### IssuePR

Links an issue to a GitHub pull request.

| Field      | Type        | Constraints                         | Description                                    |
| ---------- | ----------- | ----------------------------------- | ---------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                             |
| issue_id   | TEXT        | NOT NULL, FOREIGN KEY → Issue.id    | The linked issue.                              |
| repo_id    | TEXT        | NOT NULL, FOREIGN KEY → Repo.id     | The repo the PR is on.                         |
| pr_number  | INTEGER     | NOT NULL                            | GitHub PR number.                              |
| pr_url     | TEXT        | NOT NULL                            | Full GitHub PR URL.                            |
| status     | TEXT        | NOT NULL, DEFAULT 'open'            | PR status. One of: `open`, `merged`, `closed`. |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                |
| updated_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                |

### IssueDependency

Tracks dependencies between issues (issue A depends on issue B).

| Field               | Type        | Constraints                                        | Description                             |
| ------------------- | ----------- | -------------------------------------------------- | --------------------------------------- |
| id                  | TEXT (UUID) | PRIMARY KEY                                        | Unique identifier.                      |
| issue_id            | TEXT        | NOT NULL, FOREIGN KEY → Issue.id ON DELETE CASCADE | The issue that has the dependency.      |
| depends_on_issue_id | TEXT        | NOT NULL, FOREIGN KEY → Issue.id ON DELETE CASCADE | The issue that must be completed first. |
| created_at          | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                |                                         |

**Constraints:**

- UNIQUE(issue_id, depends_on_issue_id) — a dependency can only be recorded once.
- Circular dependencies are prevented at the repository level.

**Automatic cleanup:**

Dependency rows are removed automatically in two cases:

1. **Issue reaches `done` status** — An event listener (`initDependencyCleanup()`) removes all rows where other issues depend on the resolved issue. This unblocks dependent issues so the captain can dispatch them.
2. **Issue is deleted** — `ON DELETE CASCADE` on both foreign keys removes all associated dependency rows.

### AgentRun

Records a single execution of an agent. Can be associated with an issue (for `/dispatch` spawns) or run standalone (for scans).

| Field        | Type        | Constraints                         | Description                                                                                                        |
| ------------ | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| id           | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                                                 |
| project_id   | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                                                    |
| issue_id     | TEXT        | FOREIGN KEY → Issue.id, NULLABLE    | The issue this run was triggered by. NULL for standalone runs (e.g., scans).                                       |
| agent_id     | TEXT        | NOT NULL                            | The agent that was spawned (e.g., `engineer`).                                                                     |
| pid          | INTEGER     | NULLABLE                            | OS process ID. NULL until the process is spawned (i.e., while `status='queued'`).                                  |
| status       | TEXT        | NOT NULL, DEFAULT 'queued'          | Current status. One of: `queued`, `running`, `completed`, `failed`, `timeout`. Runs start in `queued` status.      |
| exit_code    | INTEGER     | NULLABLE                            | Process exit code. NULL if not yet completed or if status is `timeout`.                                            |
| cost_usd     | REAL        | NULLABLE                            | Estimated cost in USD from the Claude API. NULL until run completes.                                               |
| duration_ms  | INTEGER     | NULLABLE                            | Wall-clock duration in milliseconds. NULL until run completes.                                                     |
| started_at   | DATETIME    | NULLABLE                            | When the agent process started. NULL while queued.                                                                 |
| completed_at | DATETIME    | NULLABLE                            | When the agent process ended. NULL while running.                                                                  |
| created_at   | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When the run record was created (i.e., when queued). Used for FIFO ordering of queued runs (oldest created first). |

### AgentRunEvent

A single streamed event from the Claude CLI (`--output-format stream-json`) captured during an agent run.

| Field        | Type        | Constraints                                           | Description                                                                                                                                       |
| ------------ | ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | TEXT (UUID) | PRIMARY KEY                                           | Unique identifier.                                                                                                                                |
| agent_run_id | TEXT        | NOT NULL, FOREIGN KEY → AgentRun.id ON DELETE CASCADE | The run this event belongs to.                                                                                                                    |
| type         | TEXT        | NOT NULL                                              | Raw event type from Claude CLI stream-json output (e.g., `assistant`, `user`, `tool_use`, `tool_result`, `rate_limit_event`, `result`). Stored as-is without mapping. |
| data         | TEXT        | NOT NULL                                              | JSON-encoded event payload from the Claude CLI. Stored raw; normalized on retrieval (see [API docs](api.md#get-run-with-events)).                 |
| created_at   | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                   | When the event was recorded.                                                                                                                      |

---

### EnvironmentVariable

A per-project environment variable injected into agent processes at spawn time.

| Field      | Type        | Constraints                         | Description                                                                            |
| ---------- | ----------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                     |
| project_id | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                        |
| key        | TEXT        | NOT NULL                            | Variable name. Must match `[A-Za-z_][A-Za-z0-9_]*`.                                    |
| value      | TEXT        | NOT NULL                            | Variable value. Stored in plaintext; masked in API responses when `is_secret` is true. |
| is_secret  | INTEGER     | NOT NULL, DEFAULT 0                 | Whether to mask the value in API responses. Stored as 0/1; exposed as boolean.         |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                        |
| updated_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                        |

**Constraints:**

- UNIQUE(project_id, key) — a key can only appear once per project.

---

### ProjectKnowledge

Structured knowledge entries that provide context to agents. Replaces the former `memory` field on Project.

| Field      | Type        | Constraints                                          | Description                                                             |
| ---------- | ----------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                                          | Unique identifier.                                                      |
| project_id | TEXT        | NOT NULL, FOREIGN KEY → Project.id ON DELETE CASCADE | Owning project.                                                         |
| title      | TEXT        | NOT NULL                                             | Short title for the knowledge entry.                                    |
| category   | TEXT        | NOT NULL                                             | Category for grouping (e.g., `architecture`, `conventions`, `gotchas`). |
| content    | TEXT        | NOT NULL                                             | The knowledge content.                                                  |
| source     | TEXT        | NULLABLE                                             | Optional source reference (e.g., file path, URL).                       |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                  |                                                                         |
| updated_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                  |                                                                         |

**Note:** As of the category-based injection refactoring, knowledge entries are delivered to agents based on their `category` field. Entries with `workflows` and `conventions` categories are injected into all agent prompts. Entries with `architecture`, `setup`, and `api` categories are available via read-only knowledge API tools that agents can query on demand.

---

### ActivityLog

Immutable audit trail of every action in the system.

| Field      | Type        | Constraints                         | Description                                                                                                                               |
| ---------- | ----------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                                                                        |
| project_id | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                                                                           |
| issue_id   | TEXT        | FOREIGN KEY → Issue.id, NULLABLE    | Related issue, if applicable.                                                                                                             |
| actor_type | TEXT        | NOT NULL                            | Who initiated the action. One of: `user`, `agent`, `system`. `agent` = the agent performed an action (posted a comment, wrote code). `system` = the system observed/recorded a lifecycle event (PR created, agent spawned/finished, status changed automatically). | `agent_id` | TEXT        | NULLABLE                            | Agent ID if actor_type is `agent`. NULL for `user` and `system` (system events include agent ID in `details` instead).                                      |
| action     | TEXT        | NOT NULL                            | Action identifier (e.g., `issue.created`, `issue.status_changed`, `comment.added`, `mention.spawned`, `mention.completed`, `pr.created`). |
| details    | TEXT        |                                     | JSON blob with action-specific data (e.g., `{"from": "open", "to": "in_progress"}`).                                                      |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                                                                           |

**Note:** This table is append-only. Rows are never updated or deleted.

---

### MonitorMessage

Stores Captain Monitor event/response history. The monitor agent writes event batches and LLM responses here. Messages are dual-written to the project's monitor chat thread (`ChatThread` with `type='monitor'`) as `ChatMessage` rows with role mapping (`user` → `event`, `assistant` → `assistant`). Migration `040_migrate_monitor_to_chat` copies existing rows into chat threads. The `MonitorMessage` table is retained for backward compatibility but is being deprecated in favor of `ChatMessage`.

| Field      | Type        | Constraints                                          | Description                   |
| ---------- | ----------- | ---------------------------------------------------- | ----------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                                          | Unique identifier.            |
| project_id | TEXT        | NOT NULL, FOREIGN KEY → Project.id ON DELETE CASCADE | Owning project.               |
| role       | TEXT        | NOT NULL, CHECK (IN 'user', 'assistant')             | Message role.                 |
| content    | TEXT        | NOT NULL                                             | Message content.              |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                  | When the message was created. |

---

### ChatThread

A persistent conversation thread for the web-based chat interface. Each thread belongs to a project and can be a monitor thread (auto-created, one per project) or a user thread (created manually). Threads can optionally hold a Claude CLI session ID for resuming conversations.

| Field      | Type        | Constraints                                          | Description                                                                                        |
| ---------- | ----------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                                          | Unique identifier.                                                                                 |
| project_id | TEXT        | NOT NULL, FOREIGN KEY → Project.id ON DELETE CASCADE | Owning project.                                                                                    |
| title      | TEXT        | NULLABLE                                             | User-visible title. NULL until renamed or auto-generated (see Chat Service).                        |
| type       | TEXT        | NOT NULL, CHECK (type IN ('monitor', 'user'))        | Thread type. `monitor` threads are auto-created (one per project); `user` threads are user-created. |
| session_id | TEXT        | NULLABLE                                             | Claude CLI session ID for `--resume`. NULL when no active session exists or session has expired.    |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                  | When the thread was created.                                                                       |
| updated_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                  | When the thread was last updated (auto-set on field changes).                                       |

**Constraints:**

- UNIQUE index on (project_id) WHERE type = 'monitor' — enforces at most one monitor thread per project. Uses a partial unique index (`idx_chat_thread_one_monitor`).

---

### ChatMessage

A message within a chat thread. Messages are ordered chronologically (ASC) for display. Supports multiple roles including user, assistant, system, event, and tool.

| Field      | Type        | Constraints                                           | Description                                                                       |
| ---------- | ----------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                                           | Unique identifier.                                                                |
| thread_id  | TEXT        | NOT NULL, FOREIGN KEY → ChatThread.id ON DELETE CASCADE | The thread this message belongs to. Deleting a thread cascades to its messages.  |
| role       | TEXT        | NOT NULL, CHECK (role IN ('user', 'assistant', 'system', 'event', 'tool')) | Message sender role.                                                             |
| content    | TEXT        | NOT NULL                                              | Message content.                                                                  |
| metadata   | TEXT        | NULLABLE                                              | JSON string for extra data (e.g., `tool_name`, `tool_input`, `success`). Parsed with `JSON.parse()` in the repository layer. |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                   | When the message was created.                                                     |

### AdminUser

Represents the single admin account for backend authentication. Only one row exists at a time.

| Field         | Type        | Constraints                         | Description                                      |
| ------------- | ----------- | ----------------------------------- | ------------------------------------------------ |
| id               | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                               |
| username         | TEXT        | NOT NULL, UNIQUE                    | Admin username.                                  |
| password_hash    | TEXT        | NOT NULL                            | Bcrypt hash of the admin password (≥ 12 rounds). |
| setup_completed  | INTEGER     | NOT NULL, DEFAULT 0                 | Whether the user has completed first-time setup (created a project). Stored as 0/1. |
| created_at       | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When the account was created.                    |

### Session

Represents an active login session. Multiple sessions can exist simultaneously for the same user (multi-device login). Logging in from a new device does not invalidate existing sessions. Logout only deletes the session of the calling device. Sessions persist indefinitely (no server-side expiry check; cookie `maxAge` is set to 10 years).

| Field      | Type     | Constraints                                            | Description                                                          |
| ---------- | -------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| id         | TEXT     | PRIMARY KEY                                            | Session token (64-char hex, `crypto.randomBytes(32)`).               |
| user_id    | TEXT     | NOT NULL, FOREIGN KEY → AdminUser.id ON DELETE CASCADE | The admin user this session belongs to.                              |
| expires_at | DATETIME | NULLABLE                                               | Far-future sentinel (`9999-12-31T23:59:59Z`); not checked by server. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP                    | When the session was created.                                        |

### ApiKey

An API key for programmatic authentication. Two tiers exist: system keys (auto-generated on startup for agent/captain use) and user keys (created via the UI for external access).

| Field        | Type     | Constraints                         | Description                                                                                                                              |
| ------------ | -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| id           | TEXT     | PRIMARY KEY                         | Unique identifier.                                                                                                                       |
| name         | TEXT     | NOT NULL                            | Human-readable label (e.g., "Claude CI Process", "system").                                                                              |
| key_hash     | TEXT     | NOT NULL                            | SHA-256 hash of the full API key. The plaintext key is never stored.                                                                     |
| key_prefix   | TEXT     | NOT NULL                            | First 11 characters of the key (e.g., `sk-a1b2c3d4`) for display identification.                                                         |
| is_system    | INTEGER  | NOT NULL, DEFAULT 0                 | Whether this is a system key (auto-generated for agent/captain use). Stored as 0/1. System keys are hidden from user-facing key listing. |
| scopes       | TEXT     | NULLABLE                            | JSON array of scope strings restricting what the key can access. `NULL` = unrestricted (admin-level, for user-created keys). System keys are created with a predefined set of non-destructive scopes. |
| created_at   | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When the key was created.                                                                                                                |
| last_used_at | DATETIME | NULLABLE                            | When the key was last used for authentication. Throttled to at most one update per minute.                                               |

**Key format:** `sk-` followed by 64 hex characters (32 random bytes). Only the SHA-256 hash is stored in the database. System keys are deleted and recreated on every server startup since the raw key only needs to live in memory for the current process lifetime.

**Scopes:** Scope constants are defined in `backend/src/constants/scopes.ts`. The system key is granted a fixed set of read-oriented and internal scopes (e.g., `issues:read`, `comments:create`, `knowledge:write`, `internal:dispatch`). Destructive admin operations (`issues:delete`, `projects:write`, `global-config:write`, `api-keys:write`, etc.) are excluded from the system key. User-created keys default to `NULL` scopes (unrestricted access).

---

### AgentConfig

Global per-agent model configuration. Applies machine-wide regardless of project. Each agent can have a model override from any provider — the model name determines which provider is used.

| Field    | Type        | Constraints                | Description                                                                                                                                        |
| -------- | ----------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| id       | TEXT (UUID) | PRIMARY KEY                | Unique identifier.                                                                                                                                 |
| agent_id | TEXT        | NOT NULL                   | Agent identifier (e.g., `engineer`, `lead`, `captain`).                                                                                            |
| provider | TEXT        | NOT NULL, DEFAULT 'claude' | AI provider for this config. One of: `claude`, `glm` (Z.AI).                                                                                       |
| model    | TEXT        | NULLABLE                   | Model override. For `claude`: `sonnet`, `opus`, `haiku`. For `glm`: `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`. NULL means use provider default. |

**Constraints:**

- UNIQUE(agent_id) — one config entry per agent.

**Model resolution order:**

1. Query `AgentConfig` by (agent_id, current_provider)
2. If not found, use provider default: `sonnet` for Claude, `glm-5-turbo` for GLM

---

### GlobalConfig

Global system-wide configuration settings. Stores key-value pairs for machine-wide settings.

| Field | Type | Constraints | Description                       |
| ----- | ---- | ----------- | --------------------------------- |
| key   | TEXT | PRIMARY KEY | Configuration key.                |
| value | TEXT | NOT NULL    | Configuration value (text-based). |

**Current keys:**

- `default_model` — Default model for all agent spawns when no per-agent override is set. One of: `sonnet` (default), `opus`, `haiku`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-4.7`.
- `max_concurrency` — Maximum number of agents that can run concurrently globally (across all projects). This is the sole concurrency limit. Range: 1–50. Default: `5`.
- `max_chain_depth` — Maximum depth of the agent dispatch chain (how many agents can be spawned in sequence). Range: 1–100. Default: `20`.
- `agent_timeout_minutes` — Maximum execution time for a single agent process before it is terminated. Range: 1–60. Default: `10`.

**Provider inference:**

The provider is determined by the model name itself:

- Models starting with `glm-` use Z.AI (requires `ZAI_API_KEY` environment variable). Agent processes receive `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` and `ANTHROPIC_AUTH_TOKEN=$ZAI_API_KEY`.
- All other models use Claude/Anthropic (default `ANTHROPIC_API_KEY`).

---

### \_migrations

Internal table that tracks which database migrations have been applied. Used by the file-based migration system to ensure each migration runs exactly once.

| Field      | Type     | Constraints                         | Description                                                           |
| ---------- | -------- | ----------------------------------- | --------------------------------------------------------------------- |
| id         | INTEGER  | PRIMARY KEY AUTOINCREMENT           | Auto-incrementing identifier.                                         |
| name       | TEXT     | NOT NULL, UNIQUE                    | Migration name derived from filename (e.g., `001_initial_migration`). |
| applied_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When the migration was applied.                                       |

**Migration System:**

Migrations are stored in `backend/src/db/migrations/` as individual files:

- `000_initial_schema.sql` — full schema for fresh databases
- `001_*.ts`, `002_*.ts`, etc. — incremental migrations

File types:

- `.sql` files contain raw DDL statements executed directly
- `.ts` files export a `run(db)` function for complex migrations (conditional logic, table recreation)

Migration naming: `NNN_description.sql` or `NNN_description.ts`. The name stored in `_migrations` matches the filename minus extension.

**Commands:**

- `npm run migrate` — run all pending migrations (standalone, does not start the server)
- `npm run migrate:create -- description` — scaffold a new migration file

**Behavior:**

- Fresh databases: `000_initial_schema.sql` runs first, creating all tables. Subsequent migrations (001+) are no-ops due to defensive checks.
- Existing databases: if any migration ≥ 001 exists in `_migrations`, migration 000 is marked applied without executing. Only new migrations run.
- All existing migrations (001-020) include defensive checks (`IF NOT EXISTS`, column existence checks) to handle both fresh and upgraded databases safely.
- Destructive migrations (table recreation) are wrapped in transactions with `foreign_keys = OFF` to prevent cascading deletes.

---

## Relationships Summary

| Relationship                  | Type        | Description                                                                 |
| ----------------------------- | ----------- | --------------------------------------------------------------------------- |
| VCSAccount → Project          | One-to-Many | A VCS account can be linked to multiple projects.                           |
| Project → Repo                | One-to-Many | A project has multiple repos.                                               |
| Project → Issue               | One-to-Many | A project has multiple issues.                                              |
| Project → ActivityLog         | One-to-Many | A project has many activity log entries.                                    |
| Project → EnvironmentVariable | One-to-Many | A project has many environment variables injected into agent processes.     |
| Project → ProjectKnowledge    | One-to-Many | A project has many knowledge entries for agent context.                     |
| AgentConfig                   | Global      | One global model config per agent (no project scope, no provider scope).    |
| Issue → Comment               | One-to-Many | An issue has many comments.                                                 |
| Issue → IssuePR               | One-to-Many | An issue can have multiple PRs (across repos).                              |
| Issue → IssueDependency       | One-to-Many | An issue can depend on multiple other issues.                               |
| Issue → ActivityLog           | One-to-Many | An issue has many activity log entries.                                     |
| Issue → AgentRun              | One-to-Many | An issue has many agent run records. Some runs (e.g., scans) have no issue. |
| AgentRun → AgentRunEvent      | One-to-Many | A run has many streamed events (ordered by created_at).                     |
| Project → AgentRun            | One-to-Many | A project has many agent run records.                                       |
| Project → MonitorMessage      | One-to-Many | A project has many monitor messages (captain event/response history).       |
| Project → ChatThread          | One-to-Many | A project has many chat threads (web chat interface).                       |
| ChatThread → ChatMessage      | One-to-Many | A thread has many messages (ordered chronologically).                       |
| AdminUser → Session           | One-to-Many | An admin user has many sessions (only one admin exists).                    |
| ApiKey                        | Standalone  | Standalone table. One system key (auto-generated) plus user-created keys.   |

## Indexes

- `idx_repo_project` on Repo(project_id)
- `idx_issue_project` on Issue(project_id)
- `idx_issue_status` on Issue(project_id, status)
- `idx_comment_issue` on Comment(issue_id)
- `idx_comment_created` on Comment(issue_id, created_at)
- `idx_issue_pr_issue` on IssuePR(issue_id)
- `idx_issue_dependency_issue` on IssueDependency(issue_id)
- `idx_issue_dependency_depends` on IssueDependency(depends_on_issue_id)
- `idx_activity_project` on ActivityLog(project_id)
- `idx_activity_issue` on ActivityLog(issue_id)
- `idx_activity_created` on ActivityLog(project_id, created_at)
- `idx_env_var_project` on EnvironmentVariable(project_id)
- `idx_project_knowledge_project` on ProjectKnowledge(project_id)
- `idx_project_knowledge_updated` on ProjectKnowledge(project_id, updated_at DESC, created_at DESC)
- `idx_agent_run_project` on AgentRun(project_id)
- `idx_agent_run_issue` on AgentRun(issue_id)
- `idx_agent_run_status` on AgentRun(project_id, status)
- `idx_agent_run_created` on AgentRun(project_id, created_at)
- `idx_agent_run_event_run` on AgentRunEvent(agent_run_id)
- `idx_agent_run_event_created` on AgentRunEvent(agent_run_id, created_at)
- `idx_monitor_message_project` on MonitorMessage(project_id)
- `idx_monitor_message_created` on MonitorMessage(project_id, created_at DESC)
- `idx_chat_thread_project` on ChatThread(project_id)
- `idx_chat_thread_project_updated` on ChatThread(project_id, updated_at DESC)
- `idx_chat_thread_one_monitor` UNIQUE on ChatThread(project_id) WHERE type = 'monitor'
- `idx_chat_message_thread` on ChatMessage(thread_id)
- `idx_chat_message_thread_created` on ChatMessage(thread_id, created_at ASC)
- `idx_api_key_hash` on ApiKey(key_hash)
