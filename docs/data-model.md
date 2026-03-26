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
┌─────────────┐    ┌──────────┐       ┌──────────┐
│GitHubAccount│0──N│ Project  │1────N│   Repo   │
└─────────────┘    └──────────┘       └──────────┘

┌──────────┐       ┌──────────┐       ┌──────────────┐
│  Issue   │1────N│ Comment  │       │ Activity Log │
└──────────┘       └──────────┘       └──────────────┘
     │1                                    │N
     │                                     │
     │N                                    │1
┌──────────────┐                      ┌──────────┐
│   IssuePR    │                      │  Issue   │
└──────────────┘                      └──────────┘

┌──────────┐       ┌──────────┐       ┌────────────────┐
│  Issue   │1────N│ AgentRun │1────N│ AgentRunEvent  │
└──────────┘       └──────────┘       └────────────────┘

┌──────────┐       ┌─────────────┐
│ Project  │1────N│ ChatMessage │
└──────────┘       └─────────────┘
```

## Entities

### Project

Represents a body of work tied to one or more GitHub repositories.

| Field                   | Type        | Constraints                                                  | Description                                                                                                                            |
| ----------------------- | ----------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| id                      | TEXT (UUID) | PRIMARY KEY                                                  | Unique identifier.                                                                                                                     |
| name                    | TEXT        | NOT NULL                                                     | Human-readable project name.                                                                                                           |
| description             | TEXT        |                                                              | Optional project description.                                                                                                          |
| max_concurrency         | INTEGER     | NOT NULL, DEFAULT 1                                          | Maximum number of agent processes running simultaneously.                                                                              |
| max_chain_depth         | INTEGER     | NOT NULL, DEFAULT 20                                         | Maximum agent dispatches per issue before requiring manual reset.                                                                      |
| auto_start              | INTEGER     | NOT NULL, DEFAULT 0                                          | Whether Captain auto-dispatches agents on new issues. Stored as 0/1; exposed as boolean.                                               |
| auto_merge              | INTEGER     | NOT NULL, DEFAULT 0                                          | Whether Captain can auto-merge PRs. When disabled, Captain reports ready PRs but cannot merge them. Stored as 0/1; exposed as boolean. |
| captain_idle_timeout_ms | INTEGER     | NULLABLE                                                     | Idle timeout in milliseconds for Captain stuck detection. NULL means disabled.                                                         |
| model                   | TEXT        | NOT NULL, DEFAULT 'sonnet'                                   | Default Claude model for agent spawning. One of: `sonnet`, `opus`.                                                                     |
| github_account_id       | TEXT        | FOREIGN KEY → GitHubAccount.id, NULLABLE, ON DELETE SET NULL | GitHub account used for cloning repos and agent git operations.                                                                        |
| created_at              | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                          |                                                                                                                                        |
| memory                  | TEXT        |                                                              | Legacy field for project memory/notes. Superseded by ProjectKnowledge.                                                                 |
| updated_at              | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                          |                                                                                                                                        |

### GitHubAccount

A GitHub account connected via Device Flow OAuth.

| Field           | Type        | Constraints                         | Description                                             |
| --------------- | ----------- | ----------------------------------- | ------------------------------------------------------- |
| id              | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                      |
| account_name    | TEXT        | NOT NULL                            | Display name for the account (matches github_username). |
| github_username | TEXT        | NOT NULL                            | GitHub username.                                        |
| oauth_token     | TEXT        | NOT NULL                            | OAuth access token. Never returned to the client.       |
| scopes          | TEXT        |                                     | Comma-separated OAuth scopes granted.                   |
| created_at      | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                         |

**Note:** `oauth_token` is stored server-side only and stripped from all API responses.

---

### Repo

A GitHub repository linked to a project.

| Field          | Type        | Constraints                         | Description                                                                                                         |
| -------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| id             | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                                                  |
| project_id     | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                                                     |
| github_url     | TEXT        | NOT NULL                            | Full GitHub repository URL (e.g., `https://github.com/org/repo`).                                                   |
| name           | TEXT        | NOT NULL                            | Repository name (e.g., `repo`).                                                                                     |
| owner          | TEXT        | NOT NULL                            | Repository owner (e.g., `org`).                                                                                     |
| local_path     | TEXT        | NOT NULL                            | Absolute path to the local clone on disk. Managed by the backend; derived from `CREWDECK_REPOS_DIR/<owner>/<name>`. |
| default_branch | TEXT        | NOT NULL, DEFAULT 'main'            | Default branch name.                                                                                                |
| created_at     | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                                                     |

**Constraints:**

- UNIQUE(project_id, github_url) — a repo can only be linked once per project.

### Issue

The fundamental unit of work.

| Field         | Type        | Constraints                         | Description                                                                                                                     |
| ------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| id            | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                                                              |
| project_id    | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                                                                 |
| title         | TEXT        | NOT NULL                            | Issue title.                                                                                                                    |
| description   | TEXT        | NOT NULL                            | Detailed issue description.                                                                                                     |
| status        | TEXT        | NOT NULL, DEFAULT 'open'            | Current status. One of: `open`, `in_progress`, `pr_created`, `pr_conflict`, `pr_failed_actions`, `pr_ready_to_merge`, `done`.   |
| created_by    | TEXT        | NOT NULL, DEFAULT 'user'            | Who created the issue. One of: `user`, `system`.                                                                                |
| chain_depth   | INTEGER     | NOT NULL, DEFAULT 0                 | Number of agent spawns on this issue. Capped at `project.max_chain_depth`.                                                      |
| branch_name   | TEXT        | NULLABLE                            | Git branch where work is being done.                                                                                            |
| worktree_path | TEXT        | NULLABLE                            | Absolute path to the git worktree.                                                                                              |
| base_branch   | TEXT        | NULLABLE                            | The branch this issue's work is based on.                                                                                       |
| repo_id       | TEXT        | FOREIGN KEY → Repo.id, NULLABLE     | The repo this issue is being worked on in.                                                                                      |
| agent_id      | TEXT        | NULLABLE                            | The agent currently assigned to this issue. One of the fixed agent IDs (engineer, lead, docs, librarian) or NULL if unassigned. |
| created_at    | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                                                                 |
| updated_at    | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                                                                 |

**Note:** When listing issues via the API (`GET /projects/:projectId/issues`), each issue is returned with additional computed fields `running_agent_id` and `running_agent_status` derived from a LEFT JOIN on the `AgentRun` table. These fields indicate the most recent running or queued agent for the issue (if any).

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

### AgentRun

Records a single execution of an agent. Can be associated with an issue (for `/dispatch` spawns) or run standalone (for scans).

| Field        | Type        | Constraints                         | Description                                                                    |
| ------------ | ----------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| id           | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                             |
| project_id   | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                |
| issue_id     | TEXT        | FOREIGN KEY → Issue.id, NULLABLE    | The issue this run was triggered by. NULL for standalone runs (e.g., scans).   |
| agent_id     | TEXT        | NOT NULL                            | The agent that was spawned (e.g., `engineer`).                                 |
| pid          | INTEGER     | NULLABLE                            | OS process ID. NULL until the process is spawned.                              |
| status       | TEXT        | NOT NULL, DEFAULT 'queued'          | Current status. One of: `queued`, `running`, `completed`, `failed`, `timeout`. |
| exit_code    | INTEGER     | NULLABLE                            | Process exit code. NULL if not yet completed or if status is `timeout`.        |
| cost_usd     | REAL        | NULLABLE                            | Estimated cost in USD from the Claude API. NULL until run completes.           |
| duration_ms  | INTEGER     | NULLABLE                            | Wall-clock duration in milliseconds. NULL until run completes.                 |
| started_at   | DATETIME    | NULLABLE                            | When the agent process started. NULL while queued.                             |
| completed_at | DATETIME    | NULLABLE                            | When the agent process ended. NULL while running.                              |
| created_at   | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When the run record was created.                                               |

### AgentRunEvent

A single streamed event from the Claude CLI (`--output-format stream-json`) captured during an agent run.

| Field        | Type        | Constraints                                           | Description                                                                                                                                       |
| ------------ | ----------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| id           | TEXT (UUID) | PRIMARY KEY                                           | Unique identifier.                                                                                                                                |
| agent_run_id | TEXT        | NOT NULL, FOREIGN KEY → AgentRun.id ON DELETE CASCADE | The run this event belongs to.                                                                                                                    |
| type         | TEXT        | NOT NULL                                              | Raw event type from Claude CLI stream-json output (e.g., `assistant`, `user`, `tool_use`, `tool_result`, `result`). Stored as-is without mapping. |
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
| agent_ids  | TEXT        | NULLABLE                                             | JSON array of agent IDs this entry applies to. NULL means all agents.   |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                  |                                                                         |
| updated_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                  |                                                                         |

**Note:** `agent_ids` is stored as a JSON string and parsed to `string[] | null` at runtime. When null, the entry applies to all agents. When set, only agents whose ID is in the array receive this knowledge.

---

### AgentRun (legacy duplicate)

> **Note:** This section duplicates the AgentRun definition above. See the earlier definition for the canonical schema.

Tracks each agent process spawn for crash recovery and observability.

| Field        | Type        | Constraints                         | Description                                                                 |
| ------------ | ----------- | ----------------------------------- | --------------------------------------------------------------------------- |
| id           | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                          |
| project_id   | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                             |
| issue_id     | TEXT        | FOREIGN KEY → Issue.id, NULLABLE    | The issue the agent was working on. NULL for standalone runs (e.g., scans). |
| agent_id     | TEXT        | NOT NULL                            | The agent identifier (e.g., `engineer`, `lead`).                            |
| pid          | INTEGER     | NOT NULL                            | OS process ID of the spawned `claude` process.                              |
| status       | TEXT        | NOT NULL, DEFAULT 'running'         | Current run status. One of: `running`, `completed`, `failed`, `timeout`.    |
| exit_code    | INTEGER     | NULLABLE                            | Exit code of the process. NULL if still running or timed out.               |
| started_at   | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When the process was spawned.                                               |
| completed_at | DATETIME    | NULLABLE                            | When the process finished. NULL if still running.                           |

**Note:** On server startup, any runs still in `running` status are orphaned (server crashed mid-run). `recoverOnStartup()` marks them `failed` and posts system comments on affected issues (if associated with an issue). The monitor service then emits `startup.scan` events to allow the Captain to evaluate current state.

---

### ActivityLog

Immutable audit trail of every action in the system.

| Field      | Type        | Constraints                         | Description                                                                                                                               |
| ---------- | ----------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                         | Unique identifier.                                                                                                                        |
| project_id | TEXT        | NOT NULL, FOREIGN KEY → Project.id  | Owning project.                                                                                                                           |
| issue_id   | TEXT        | FOREIGN KEY → Issue.id, NULLABLE    | Related issue, if applicable.                                                                                                             |
| actor_type | TEXT        | NOT NULL                            | Who performed the action. One of: `user`, `agent`, `system`.                                                                              |
| actor_id   | TEXT        | NULLABLE                            | Agent.id if actor_type is `agent`.                                                                                                        |
| action     | TEXT        | NOT NULL                            | Action identifier (e.g., `issue.created`, `issue.status_changed`, `comment.added`, `mention.spawned`, `mention.completed`, `pr.created`). |
| details    | TEXT        |                                     | JSON blob with action-specific data (e.g., `{"from": "open", "to": "in_progress"}`).                                                      |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP |                                                                                                                                           |

**Note:** This table is append-only. Rows are never updated or deleted.

---

### ChatMessage

Stores conversation history for the Captain Monitor LLM agent. All messages are sessionless (used only by Monitor for automated orchestration).

| Field      | Type        | Constraints                                          | Description                                                                  |
| ---------- | ----------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                                          | Unique identifier.                                                           |
| project_id | TEXT        | NOT NULL, FOREIGN KEY → Project.id ON DELETE CASCADE | Owning project.                                                              |
| session_id | TEXT        | NULLABLE                                             | Always NULL (legacy field retained for Monitor's sessionless message store). |
| role       | TEXT        | NOT NULL, CHECK (IN 'user', 'assistant')             | Message role. `user` for event batches, `assistant` for Monitor responses.   |
| content    | TEXT        | NOT NULL                                             | Message content.                                                             |
| images     | TEXT        | NULLABLE                                             | Always NULL (not used by Monitor).                                           |
| created_at | DATETIME    | NOT NULL, DEFAULT CURRENT_TIMESTAMP                  | When the message was created.                                                |

**Note:** This table was originally designed for chat sessions but is now used exclusively by the Monitor service for its conversation history (`session_id = NULL`). The table and `session_id` column are retained for compatibility with existing migrations. Monitor queries use `WHERE session_id IS NULL` to retrieve its history.

### AgentConfig

Per-agent model override for a project. When set, the agent uses the specified model instead of the project default.

| Field      | Type        | Constraints                                          | Description                                                               |
| ---------- | ----------- | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| id         | TEXT (UUID) | PRIMARY KEY                                          | Unique identifier.                                                        |
| project_id | TEXT        | NOT NULL, FOREIGN KEY → Project.id ON DELETE CASCADE | Owning project.                                                           |
| agent_id   | TEXT        | NOT NULL                                             | Agent identifier (e.g., `engineer`, `lead`, `captain`).                   |
| model      | TEXT        | NULLABLE                                             | Model override. One of: `sonnet`, `opus`. NULL means use project default. |

**Constraints:**

- UNIQUE(project_id, agent_id) — one config entry per agent per project.

**Model resolution order:** AgentConfig.model → Project.model → `"sonnet"` (hardcoded fallback).

---

### \_migrations

Internal table that tracks which database migrations have been applied. Used by the file-based migration system to ensure each migration runs exactly once.

| Field      | Type     | Constraints                         | Description                                                            |
| ---------- | -------- | ----------------------------------- | ---------------------------------------------------------------------- |
| id         | INTEGER  | PRIMARY KEY AUTOINCREMENT           | Auto-incrementing identifier.                                          |
| name       | TEXT     | NOT NULL, UNIQUE                    | Migration name derived from filename (e.g., `001_add_github_account`). |
| applied_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When the migration was applied.                                        |

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
| GitHubAccount → Project       | One-to-Many | A GitHub account can be linked to multiple projects.                        |
| Project → Repo                | One-to-Many | A project has multiple repos.                                               |
| Project → Issue               | One-to-Many | A project has multiple issues.                                              |
| Project → ActivityLog         | One-to-Many | A project has many activity log entries.                                    |
| Project → EnvironmentVariable | One-to-Many | A project has many environment variables injected into agent processes.     |
| Project → ProjectKnowledge    | One-to-Many | A project has many knowledge entries for agent context.                     |
| Project → AgentConfig         | One-to-Many | A project has many per-agent model override configs.                        |
| Issue → Comment               | One-to-Many | An issue has many comments.                                                 |
| Issue → IssuePR               | One-to-Many | An issue can have multiple PRs (across repos).                              |
| Issue → ActivityLog           | One-to-Many | An issue has many activity log entries.                                     |
| Issue → AgentRun              | One-to-Many | An issue has many agent run records. Some runs (e.g., scans) have no issue. |
| AgentRun → AgentRunEvent      | One-to-Many | A run has many streamed events (ordered by created_at).                     |
| Project → AgentRun            | One-to-Many | A project has many agent run records.                                       |
| Project → ChatMessage         | One-to-Many | A project has many monitor messages (all sessionless, used by Monitor).     |

## Indexes

- `idx_repo_project` on Repo(project_id)
- `idx_issue_project` on Issue(project_id)
- `idx_issue_status` on Issue(project_id, status)
- `idx_comment_issue` on Comment(issue_id)
- `idx_comment_created` on Comment(issue_id, created_at)
- `idx_issue_pr_issue` on IssuePR(issue_id)
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
- `idx_chat_message_project` on ChatMessage(project_id)
- `idx_chat_message_created` on ChatMessage(project_id, created_at DESC)
