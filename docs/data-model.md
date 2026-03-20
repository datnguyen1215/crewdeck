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
```

## Entities

### Project

Represents a body of work tied to one or more GitHub repositories.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| name | TEXT | NOT NULL | Human-readable project name. |
| description | TEXT | | Optional project description. |
| max_concurrency | INTEGER | NOT NULL, DEFAULT 1 | Maximum number of agent processes running simultaneously. |
| github_account_id | TEXT | FOREIGN KEY → GitHubAccount.id, NULLABLE, ON DELETE SET NULL | GitHub account used for cloning repos and agent git operations. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### GitHubAccount

A GitHub account connected via Device Flow OAuth.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| account_name | TEXT | NOT NULL | Display name for the account (matches github_username). |
| github_username | TEXT | NOT NULL | GitHub username. |
| oauth_token | TEXT | NOT NULL | OAuth access token. Never returned to the client. |
| scopes | TEXT | | Comma-separated OAuth scopes granted. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Note:** `oauth_token` is stored server-side only and stripped from all API responses.

---

### Repo

A GitHub repository linked to a project.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| project_id | TEXT | NOT NULL, FOREIGN KEY → Project.id | Owning project. |
| github_url | TEXT | NOT NULL | Full GitHub repository URL (e.g., `https://github.com/org/repo`). |
| name | TEXT | NOT NULL | Repository name (e.g., `repo`). |
| owner | TEXT | NOT NULL | Repository owner (e.g., `org`). |
| local_path | TEXT | NOT NULL | Absolute path to the local clone on disk. Managed by the backend; derived from `CREWDECK_REPOS_DIR/<owner>/<name>`. |
| default_branch | TEXT | NOT NULL, DEFAULT 'main' | Default branch name. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Constraints:**
- UNIQUE(project_id, github_url) — a repo can only be linked once per project.

### Issue

The fundamental unit of work.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| project_id | TEXT | NOT NULL, FOREIGN KEY → Project.id | Owning project. |
| title | TEXT | NOT NULL | Issue title. |
| description | TEXT | NOT NULL | Detailed issue description. |
| status | TEXT | NOT NULL, DEFAULT 'open' | Current status. One of: `open`, `in_progress`, `pr_created`, `done`. |
| priority | INTEGER | NOT NULL, DEFAULT 0 | Priority score. Higher = more urgent. |
| created_by | TEXT | NOT NULL, DEFAULT 'user' | Who created the issue. One of: `user`, `system`. |
| chain_depth | INTEGER | NOT NULL, DEFAULT 0 | Number of agent spawns on this issue. Capped at 20. |
| branch_name | TEXT | NULLABLE | Git branch where work is being done. |
| worktree_path | TEXT | NULLABLE | Absolute path to the git worktree. |
| base_branch | TEXT | NULLABLE | The branch this issue's work is based on. |
| repo_id | TEXT | FOREIGN KEY → Repo.id, NULLABLE | The repo this issue is being worked on in. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### Comment

A message on an issue from an agent, the system, or a human.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| issue_id | TEXT | NOT NULL, FOREIGN KEY → Issue.id | The issue this comment belongs to. |
| author_type | TEXT | NOT NULL | Who posted it. One of: `user`, `agent`, `system`. |
| author_id | TEXT | NULLABLE | If author_type is `agent`, the Agent.id. NULL for user/system. |
| content | TEXT | NOT NULL | Comment body (Markdown supported). |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### IssuePR

Links an issue to a GitHub pull request.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| issue_id | TEXT | NOT NULL, FOREIGN KEY → Issue.id | The linked issue. |
| repo_id | TEXT | NOT NULL, FOREIGN KEY → Repo.id | The repo the PR is on. |
| pr_number | INTEGER | NOT NULL | GitHub PR number. |
| pr_url | TEXT | NOT NULL | Full GitHub PR URL. |
| status | TEXT | NOT NULL, DEFAULT 'open' | PR status. One of: `open`, `merged`, `closed`. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### EnvironmentVariable

A per-project environment variable injected into agent processes at spawn time.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| project_id | TEXT | NOT NULL, FOREIGN KEY → Project.id | Owning project. |
| key | TEXT | NOT NULL | Variable name. Must match `[A-Za-z_][A-Za-z0-9_]*`. |
| value | TEXT | NOT NULL | Variable value. Stored in plaintext; masked in API responses when `is_secret` is true. |
| is_secret | INTEGER | NOT NULL, DEFAULT 0 | Whether to mask the value in API responses. Stored as 0/1; exposed as boolean. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Constraints:**
- UNIQUE(project_id, key) — a key can only appear once per project.

---

### ActivityLog

Immutable audit trail of every action in the system.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| project_id | TEXT | NOT NULL, FOREIGN KEY → Project.id | Owning project. |
| issue_id | TEXT | FOREIGN KEY → Issue.id, NULLABLE | Related issue, if applicable. |
| actor_type | TEXT | NOT NULL | Who performed the action. One of: `user`, `agent`, `system`. |
| actor_id | TEXT | NULLABLE | Agent.id if actor_type is `agent`. |
| action | TEXT | NOT NULL | Action identifier (e.g., `issue.created`, `issue.status_changed`, `comment.added`, `mention.spawned`, `mention.completed`, `pr.created`). |
| details | TEXT | | JSON blob with action-specific data (e.g., `{"from": "open", "to": "in_progress"}`). |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Note:** This table is append-only. Rows are never updated or deleted.

## Relationships Summary

| Relationship | Type | Description |
|-------------|------|-------------|
| GitHubAccount → Project | One-to-Many | A GitHub account can be linked to multiple projects. |
| Project → Repo | One-to-Many | A project has multiple repos. |
| Project → Issue | One-to-Many | A project has multiple issues. |
| Project → ActivityLog | One-to-Many | A project has many activity log entries. |
| Project → EnvironmentVariable | One-to-Many | A project has many environment variables injected into agent processes. |
| Issue → Comment | One-to-Many | An issue has many comments. |
| Issue → IssuePR | One-to-Many | An issue can have multiple PRs (across repos). |
| Issue → ActivityLog | One-to-Many | An issue has many activity log entries. |

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
