import "dotenv/config";

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function parseIntEnv(name: string, fallback: number): number {
  const val = parseInt(optional(name, String(fallback)), 10);
  if (isNaN(val)) throw new Error(`${name} must be a valid integer`);
  return val;
}

export * from "./config/orchestration.js";

export const config = {
  port: parseIntEnv("PORT", 9381),
  host: optional("HOST", "localhost"),
  dbPath: optional("DB_PATH", "./data/crewdeck.db"),
  logLevel: optional("LOG_LEVEL", "info"),
  processMonitorInterval: parseIntEnv("PROCESS_MONITOR_INTERVAL", 5000),
  agentKillTimeout: parseIntEnv("AGENT_KILL_TIMEOUT", 5000),
  nodeEnv: optional("NODE_ENV", "development"),
  reposDir: optional("CREWDECK_REPOS_DIR", "./data/repos"),
  logFilePath: optional("LOG_FILE_PATH", "./data/server.log"),
  worktreesDir: optional("CREWDECK_WORKTREES_DIR", "./data/worktrees"),
  reposHostPath: process.env.CREWDECK_REPOS_HOST_PATH || "",
  reposContainerPath: process.env.CREWDECK_REPOS_CONTAINER_PATH || "",
  postgresHost: optional("POSTGRES_HOST", "localhost"),
  postgresPort: parseIntEnv("POSTGRES_PORT", 5432),
  postgresUser: optional("POSTGRES_USER", "crewdeck"),
  postgresPassword: optional("POSTGRES_PASSWORD", "crewdeck"),
};
