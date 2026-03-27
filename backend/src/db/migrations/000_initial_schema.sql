CREATE TABLE IF NOT EXISTS Project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  max_concurrency INTEGER NOT NULL DEFAULT 1,
  max_chain_depth INTEGER NOT NULL DEFAULT 20,
  agent_timeout_minutes INTEGER NOT NULL DEFAULT 10,
  memory TEXT,
  model TEXT NOT NULL DEFAULT 'sonnet',
  vcs_account_id TEXT REFERENCES VCSAccount(id) ON DELETE SET NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Repo (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id),
  repo_url TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  local_path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, repo_url)
);

CREATE TABLE IF NOT EXISTS Issue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL DEFAULT 'user',
  chain_depth INTEGER NOT NULL DEFAULT 0,
  branch_name TEXT,
  worktree_path TEXT,
  base_branch TEXT,
  repo_id TEXT REFERENCES Repo(id),
  agent_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Comment (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES Issue(id),
  author_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

CREATE TABLE IF NOT EXISTS VCSAccount (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'github',
  account_name TEXT NOT NULL,
  username TEXT NOT NULL,
  token TEXT NOT NULL,
  ssh_private_key TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS EnvironmentVariable (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_repo_project ON Repo(project_id);
CREATE INDEX IF NOT EXISTS idx_issue_project ON Issue(project_id);
CREATE INDEX IF NOT EXISTS idx_issue_status ON Issue(project_id, status);
CREATE INDEX IF NOT EXISTS idx_comment_issue ON Comment(issue_id);
CREATE INDEX IF NOT EXISTS idx_comment_created ON Comment(issue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_issue_pr_issue ON IssuePR(issue_id);
CREATE INDEX IF NOT EXISTS idx_activity_project ON ActivityLog(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_issue ON ActivityLog(issue_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON ActivityLog(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_env_var_project ON EnvironmentVariable(project_id);

-- Agent run persistence
CREATE TABLE IF NOT EXISTS AgentRun (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id),
  issue_id TEXT REFERENCES Issue(id),
  agent_id TEXT NOT NULL,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  exit_code INTEGER,
  cost_usd REAL,
  duration_ms INTEGER,
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS AgentRunEvent (
  id TEXT PRIMARY KEY,
  agent_run_id TEXT NOT NULL REFERENCES AgentRun(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_run_project ON AgentRun(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_issue ON AgentRun(issue_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_status ON AgentRun(project_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_run_created ON AgentRun(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_event_run ON AgentRunEvent(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_event_created ON AgentRunEvent(agent_run_id, created_at);

-- Project knowledge entries
CREATE TABLE IF NOT EXISTS ProjectKnowledge (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_knowledge_project ON ProjectKnowledge(project_id);
CREATE INDEX IF NOT EXISTS idx_project_knowledge_updated ON ProjectKnowledge(project_id, updated_at DESC, created_at DESC);

-- Chat sessions
CREATE TABLE IF NOT EXISTS ChatSession (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
  title TEXT,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_session_project ON ChatSession(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_status ON ChatSession(project_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_session_created ON ChatSession(project_id, created_at DESC);

-- Chat messages
CREATE TABLE IF NOT EXISTS ChatMessage (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES ChatSession(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  images TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_message_project ON ChatMessage(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_session ON ChatMessage(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_created ON ChatMessage(project_id, created_at DESC);

-- Per-agent model overrides
CREATE TABLE IF NOT EXISTS AgentConfig (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES Project(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  model TEXT,
  UNIQUE(project_id, agent_id)
);

-- Migration version tracking
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
