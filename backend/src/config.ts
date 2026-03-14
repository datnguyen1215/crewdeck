import "dotenv/config";

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function parseIntEnv(name: string, fallback: number): number {
  const val = parseInt(optional(name, String(fallback)), 10);
  if (isNaN(val)) throw new Error(`${name} must be a valid integer`);
  return val;
}

export const config = {
  port: parseIntEnv("PORT", 3000),
  host: optional("HOST", "localhost"),
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:5173"),
  dbPath: optional("DB_PATH", "./data/crewdeck.db"),
  logLevel: optional("LOG_LEVEL", "info"),
  processMonitorInterval: parseIntEnv("PROCESS_MONITOR_INTERVAL", 5000),
  agentKillTimeout: parseIntEnv("AGENT_KILL_TIMEOUT", 5000),
  nodeEnv: optional("NODE_ENV", "development"),
  reposDir: optional("CREWDECK_REPOS_DIR", "./data/repos"),
};
