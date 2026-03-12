-- Project and Session have a circular reference (Project.orchestrator_session_id → Session).
-- We omit the FK on orchestrator_session_id and enforce integrity at the application level.

CREATE TABLE IF NOT EXISTS Project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  max_review_rounds INTEGER NOT NULL DEFAULT 3,
  orchestrator_session_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Repo (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id),
  github_url TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  local_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, github_url)
);

CREATE TABLE IF NOT EXISTS Crew (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES Project(id),
  name TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Agent (
  id TEXT PRIMARY KEY,
  crew_id TEXT NOT NULL REFERENCES Crew(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  expertise TEXT,
  system_prompt TEXT NOT NULL,
  can_review INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Issue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority INTEGER NOT NULL DEFAULT 0,
  assigned_agent_id TEXT REFERENCES Agent(id),
  created_by TEXT NOT NULL DEFAULT 'user',
  max_review_rounds INTEGER,
  current_review_round INTEGER NOT NULL DEFAULT 0,
  branch_name TEXT,
  worktree_path TEXT,
  base_branch TEXT,
  repo_id TEXT REFERENCES Repo(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Comment (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES Issue(id),
  author_type TEXT NOT NULL,
  author_id TEXT,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Session (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id),
  session_type TEXT NOT NULL,
  agent_id TEXT REFERENCES Agent(id),
  issue_id TEXT REFERENCES Issue(id),
  tmux_session_name TEXT,
  tmux_pane_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  context TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS IssueAgent (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES Issue(id),
  agent_id TEXT NOT NULL REFERENCES Agent(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  review_order INTEGER,
  session_id TEXT REFERENCES Session(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(issue_id, agent_id, role)
);

CREATE TABLE IF NOT EXISTS IssuePR (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES Issue(id),
  repo_id TEXT NOT NULL REFERENCES Repo(id),
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(issue_id, repo_id, pr_number)
);

CREATE TABLE IF NOT EXISTS ActivityLog (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id),
  issue_id TEXT REFERENCES Issue(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_repo_project ON Repo(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_crew ON Agent(crew_id);
CREATE INDEX IF NOT EXISTS idx_issue_project ON Issue(project_id);
CREATE INDEX IF NOT EXISTS idx_issue_status ON Issue(project_id, status);
CREATE INDEX IF NOT EXISTS idx_issue_assigned ON Issue(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_comment_issue ON Comment(issue_id);
CREATE INDEX IF NOT EXISTS idx_comment_created ON Comment(issue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_issue_agent_issue ON IssueAgent(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_agent_agent ON IssueAgent(agent_id);
CREATE INDEX IF NOT EXISTS idx_issue_pr_issue ON IssuePR(issue_id);
CREATE INDEX IF NOT EXISTS idx_session_project ON Session(project_id);
CREATE INDEX IF NOT EXISTS idx_session_issue ON Session(issue_id);
CREATE INDEX IF NOT EXISTS idx_activity_project ON ActivityLog(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_issue ON ActivityLog(issue_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON ActivityLog(project_id, created_at);
