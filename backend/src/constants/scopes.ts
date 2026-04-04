/** API key scope constants. */
export const Scope = {
  // Issues — system key allowed: read, create, update
  ISSUES_READ: "issues:read",
  ISSUES_CREATE: "issues:create",
  ISSUES_UPDATE: "issues:update",
  ISSUES_DELETE: "issues:delete",
  ISSUES_PAUSE: "issues:pause",
  ISSUES_RESUME: "issues:resume",
  ISSUES_APPROVE: "issues:approve",

  // Comments — system key allowed: read, create
  COMMENTS_READ: "comments:read",
  COMMENTS_CREATE: "comments:create",
  COMMENTS_EDIT: "comments:edit",
  COMMENTS_DELETE: "comments:delete",

  // Knowledge — system key allowed: read, write, delete, scan
  KNOWLEDGE_READ: "knowledge:read",
  KNOWLEDGE_WRITE: "knowledge:write",
  KNOWLEDGE_DELETE: "knowledge:delete",
  KNOWLEDGE_SCAN: "knowledge:scan",

  // Projects — system key allowed: read
  PROJECTS_READ: "projects:read",
  PROJECTS_WRITE: "projects:write",
  PROJECTS_DELETE: "projects:delete",

  // Repos — system key allowed: read
  REPOS_READ: "repos:read",
  REPOS_WRITE: "repos:write",
  REPOS_DELETE: "repos:delete",

  // Runs — system key allowed: read
  RUNS_READ: "runs:read",

  // Activity — system key allowed: read
  ACTIVITY_READ: "activity:read",

  // Monitor — system key allowed: read
  MONITOR_READ: "monitor:read",

  // Agents — system key allowed: read
  AGENTS_READ: "agents:read",

  // Internal — system key allowed
  INTERNAL_COMMENT: "internal:comment",
  INTERNAL_CREATE_ISSUE: "internal:create-issue",
  INTERNAL_CREATE_PR: "internal:create-pr",
  INTERNAL_DISPATCH: "internal:dispatch",
  INTERNAL_MERGE: "internal:merge",
  INTERNAL_SCAN: "internal:scan",
  INTERNAL_KNOWLEDGE_READ: "internal:knowledge-read",
  INTERNAL_KNOWLEDGE_WRITE: "internal:knowledge-write",

  // Global config — admin only
  GLOBAL_CONFIG_READ: "global-config:read",
  GLOBAL_CONFIG_WRITE: "global-config:write",

  // VCS accounts — admin only
  VCS_ACCOUNTS_READ: "vcs-accounts:read",
  VCS_ACCOUNTS_WRITE: "vcs-accounts:write",
  VCS_ACCOUNTS_DELETE: "vcs-accounts:delete",

  // API keys — admin only
  API_KEYS_READ: "api-keys:read",
  API_KEYS_WRITE: "api-keys:write",
  API_KEYS_DELETE: "api-keys:delete",

  // Environment variables — admin only
  ENVIRONMENT_READ: "environment:read",
  ENVIRONMENT_WRITE: "environment:write",
  ENVIRONMENT_DELETE: "environment:delete",

  // Chat — admin only
  CHAT_READ: "chat:read",
  CHAT_WRITE: "chat:write",
  CHAT_DELETE: "chat:delete",

  // Terminal — admin only
  TERMINAL_READ: "terminal:read",
  TERMINAL_WRITE: "terminal:write",
  TERMINAL_DELETE: "terminal:delete",

  // Agent config — admin only
  AGENT_CONFIG_READ: "agent-config:read",
  AGENT_CONFIG_WRITE: "agent-config:write",
  AGENT_CONFIG_DELETE: "agent-config:delete",
} as const;

export type ScopeValue = (typeof Scope)[keyof typeof Scope];

export const ALL_SCOPES = Object.values(Scope);

/** Scopes granted to the system API key. */
export const SYSTEM_KEY_SCOPES: readonly ScopeValue[] = [
  Scope.ISSUES_READ,
  Scope.ISSUES_CREATE,
  Scope.ISSUES_UPDATE,
  Scope.COMMENTS_READ,
  Scope.COMMENTS_CREATE,
  Scope.KNOWLEDGE_READ,
  Scope.KNOWLEDGE_WRITE,
  Scope.KNOWLEDGE_DELETE,
  Scope.KNOWLEDGE_SCAN,
  Scope.PROJECTS_READ,
  Scope.REPOS_READ,
  Scope.RUNS_READ,
  Scope.ACTIVITY_READ,
  Scope.MONITOR_READ,
  Scope.AGENTS_READ,
  Scope.INTERNAL_COMMENT,
  Scope.INTERNAL_CREATE_ISSUE,
  Scope.INTERNAL_CREATE_PR,
  Scope.INTERNAL_DISPATCH,
  Scope.INTERNAL_MERGE,
  Scope.INTERNAL_SCAN,
  Scope.INTERNAL_KNOWLEDGE_READ,
  Scope.INTERNAL_KNOWLEDGE_WRITE,
] as const;
