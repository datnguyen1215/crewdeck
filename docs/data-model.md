---
title: CrewDeck Data Model
version: 0.2.0
status: draft
---

# CrewDeck — Data Model

## Overview

All persistent state is stored in a local SQLite database. This document defines every entity, its fields, relationships, and constraints.

## Entity Relationship Diagram

```
┌──────────┐       ┌──────────┐       ┌──────────┐
│ Project  │1────N│   Repo   │       │  Agent   │
└──────────┘       └──────────┘       └──────────┘
     │1                                    │N
     │                                     │
     │N                                    │1
┌──────────┐                          ┌──────────┐
│   Crew   │1────────────────────N───│  Agent   │
└──────────┘                          └──────────┘
     │1
     │
     │ (project has one orchestrator session)
     │
┌──────────────┐
│   Session    │
└──────────────┘

┌──────────┐       ┌──────────┐       ┌──────────────┐
│  Issue   │1────N│ Comment  │       │ Activity Log │
└──────────┘       └──────────┘       └──────────────┘
     │1                                    │N
     │                                     │
     │N                                    │1
┌──────────────┐                      ┌──────────┐
│ IssueAgent   │                      │  Issue   │
└──────────────┘                      └──────────┘
     │
     │
┌──────────────┐
│   Session    │
└──────────────┘

┌──────────┐       ┌──────────────┐
│  Issue   │1────N│  IssuePR     │
└──────────┘       └──────────────┘
```

## Entities

### Project

Represents a body of work tied to one or more GitHub repositories.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| name | TEXT | NOT NULL | Human-readable project name. |
| description | TEXT | | Optional project description. |
| max_concurrency | INTEGER | NOT NULL, DEFAULT 1 | Maximum number of issues worked on simultaneously. |
| max_review_rounds | INTEGER | NOT NULL, DEFAULT 3 | Default max review loop iterations before escalation. |
| orchestrator_session_id | TEXT | FOREIGN KEY → Session.id, NULLABLE | Session ID for the project's orchestrator. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### Repo

A GitHub repository linked to a project.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| project_id | TEXT | NOT NULL, FOREIGN KEY → Project.id | Owning project. |
| github_url | TEXT | NOT NULL | Full GitHub repository URL (e.g., `https://github.com/org/repo`). |
| name | TEXT | NOT NULL | Repository name (e.g., `repo`). |
| owner | TEXT | NOT NULL | Repository owner (e.g., `org`). |
| local_path | TEXT | NOT NULL | Absolute path to the local clone on disk. |
| default_branch | TEXT | NOT NULL, DEFAULT 'main' | Default branch name. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Constraints:**
- UNIQUE(project_id, github_url) — a repo can only be linked once per project.

### Crew

A team of agents belonging to a project. Each project has exactly one crew.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| project_id | TEXT | NOT NULL, UNIQUE, FOREIGN KEY → Project.id | Owning project (one crew per project). |
| name | TEXT | NOT NULL | Crew name (e.g., "Backend Team"). |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### Agent

A specialized AI persona within a crew.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| crew_id | TEXT | NOT NULL, FOREIGN KEY → Crew.id | Owning crew. |
| name | TEXT | NOT NULL | Agent name (e.g., "Alice — Senior Engineer"). |
| role | TEXT | NOT NULL | Short role label (e.g., "Senior Software Engineer"). |
| expertise | TEXT | | Comma-separated or JSON array of expertise areas. Used by orchestrator for assignment. |
| system_prompt | TEXT | NOT NULL | Full system prompt defining this agent's persona and behavior. |
| can_review | INTEGER | NOT NULL, DEFAULT 1 | Whether this agent participates in reviews (1 = yes, 0 = no). |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### Issue

The fundamental unit of work.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| project_id | TEXT | NOT NULL, FOREIGN KEY → Project.id | Owning project. |
| title | TEXT | NOT NULL | Issue title. |
| description | TEXT | NOT NULL | Detailed issue description. |
| status | TEXT | NOT NULL, DEFAULT 'open' | Current status. One of: `draft`, `open`, `in_progress`, `in_review`, `feedback`, `ready`, `pr_created`, `done`. |
| priority | INTEGER | NOT NULL, DEFAULT 0 | Priority score assigned by orchestrator. Higher = more urgent. |
| assigned_agent_id | TEXT | FOREIGN KEY → Agent.id, NULLABLE | The agent currently assigned to work on this issue. |
| created_by | TEXT | NOT NULL, DEFAULT 'user' | Who created the issue. One of: `user`, `orchestrator`. |
| max_review_rounds | INTEGER | NULLABLE | Override for project-level max_review_rounds. NULL means use project default. |
| current_review_round | INTEGER | NOT NULL, DEFAULT 0 | Current review iteration count. |
| branch_name | TEXT | NULLABLE | Git branch where work is being done. |
| worktree_path | TEXT | NULLABLE | Absolute path to the git worktree. |
| base_branch | TEXT | NULLABLE | The branch this issue's work is based on. |
| repo_id | TEXT | FOREIGN KEY → Repo.id, NULLABLE | The repo this issue is being worked on in. Set by the agent. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### Comment

A message on an issue from an agent, the orchestrator, or a human.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| issue_id | TEXT | NOT NULL, FOREIGN KEY → Issue.id | The issue this comment belongs to. |
| author_type | TEXT | NOT NULL | Who posted it. One of: `user`, `agent`, `orchestrator`. |
| author_id | TEXT | NULLABLE | If author_type is `agent`, the Agent.id. NULL for user/orchestrator. |
| content | TEXT | NOT NULL | Comment body (Markdown supported). |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### IssueAgent

Tracks which agents are involved with an issue and their role (worker vs. reviewer).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| issue_id | TEXT | NOT NULL, FOREIGN KEY → Issue.id | The issue. |
| agent_id | TEXT | NOT NULL, FOREIGN KEY → Agent.id | The agent. |
| role | TEXT | NOT NULL | Role on this issue. One of: `worker`, `reviewer`. |
| status | TEXT | NOT NULL, DEFAULT 'pending' | Agent's status on this issue. One of: `pending`, `active`, `approved`, `changes_requested`, `done`. |
| review_order | INTEGER | NULLABLE | Order in which this reviewer is invoked (1, 2, 3...). NULL for workers. |
| session_id | TEXT | FOREIGN KEY → Session.id, NULLABLE | The tmux/CLI session for this agent on this issue. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Constraints:**
- UNIQUE(issue_id, agent_id, role) — an agent can only have one role per issue.

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

### Session

Tracks AI CLI session context. Owned by CrewDeck, not the underlying CLI tool.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. Used as the session reference. |
| project_id | TEXT | NOT NULL, FOREIGN KEY → Project.id | Owning project. |
| session_type | TEXT | NOT NULL | Type of session. One of: `orchestrator`, `worker`, `reviewer`, `utility`. |
| agent_id | TEXT | FOREIGN KEY → Agent.id, NULLABLE | The agent this session belongs to. NULL for orchestrator sessions. |
| issue_id | TEXT | FOREIGN KEY → Issue.id, NULLABLE | The issue this session is working on. NULL for orchestrator sessions. |
| tmux_session_name | TEXT | NULLABLE | Name of the tmux session (if active). |
| tmux_pane_id | TEXT | NULLABLE | The tmux pane ID for capturing output. |
| status | TEXT | NOT NULL, DEFAULT 'idle' | Session status. One of: `idle`, `running`, `completed`, `error`. |
| context | TEXT | | JSON blob storing conversation history and state for session resumption. |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |
| updated_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

### ActivityLog

Immutable audit trail of every action in the system.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | TEXT (UUID) | PRIMARY KEY | Unique identifier. |
| project_id | TEXT | NOT NULL, FOREIGN KEY → Project.id | Owning project. |
| issue_id | TEXT | FOREIGN KEY → Issue.id, NULLABLE | Related issue, if applicable. |
| actor_type | TEXT | NOT NULL | Who performed the action. One of: `user`, `agent`, `orchestrator`, `system`. |
| actor_id | TEXT | NULLABLE | Agent.id if actor_type is `agent`. |
| action | TEXT | NOT NULL | Action identifier (e.g., `issue.created`, `issue.status_changed`, `comment.added`, `agent.assigned`, `session.started`, `pr.created`). |
| details | TEXT | | JSON blob with action-specific data (e.g., `{"from": "open", "to": "in_progress"}`). |
| created_at | DATETIME | NOT NULL, DEFAULT CURRENT_TIMESTAMP | |

**Note:** This table is append-only. Rows are never updated or deleted.

## Relationships Summary

| Relationship | Type | Description |
|-------------|------|-------------|
| Project → Repo | One-to-Many | A project has multiple repos. |
| Project → Crew | One-to-One | A project has exactly one crew. |
| Project → Issue | One-to-Many | A project has multiple issues. |
| Project → Session | One-to-Many | A project has multiple sessions (orchestrator + agent sessions). |
| Project → ActivityLog | One-to-Many | A project has many activity log entries. |
| Crew → Agent | One-to-Many | A crew has multiple agents. |
| Issue → Comment | One-to-Many | An issue has many comments. |
| Issue → IssueAgent | One-to-Many | An issue has many agent assignments. |
| Issue → IssuePR | One-to-Many | An issue can have multiple PRs (across repos). |
| Issue → ActivityLog | One-to-Many | An issue has many activity log entries. |
| Agent → IssueAgent | One-to-Many | An agent can be assigned to many issues. |
| Agent → Session | One-to-Many | An agent can have multiple sessions (one per issue). |
| IssueAgent → Session | One-to-One | Each agent assignment on an issue has one session. |

## Indexes

The following indexes should be created for query performance:

- `idx_repo_project` on Repo(project_id)
- `idx_agent_crew` on Agent(crew_id)
- `idx_issue_project` on Issue(project_id)
- `idx_issue_status` on Issue(project_id, status)
- `idx_issue_assigned` on Issue(assigned_agent_id)
- `idx_comment_issue` on Comment(issue_id)
- `idx_comment_created` on Comment(issue_id, created_at)
- `idx_issue_agent_issue` on IssueAgent(issue_id)
- `idx_issue_agent_agent` on IssueAgent(agent_id)
- `idx_issue_pr_issue` on IssuePR(issue_id)
- `idx_session_project` on Session(project_id)
- `idx_session_issue` on Session(issue_id)
- `idx_activity_project` on ActivityLog(project_id)
- `idx_activity_issue` on ActivityLog(issue_id)
- `idx_activity_created` on ActivityLog(project_id, created_at)
