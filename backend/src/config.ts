import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),
  host: optional("HOST", "localhost"),
  corsOrigin: optional("CORS_ORIGIN", "http://localhost:5173"),
  dbPath: optional("DB_PATH", "./data/crewdeck.db"),
  logLevel: optional("LOG_LEVEL", "info"),
  tmuxPollInterval: parseInt(optional("TMUX_POLL_INTERVAL", "100"), 10),
  processMonitorInterval: parseInt(optional("PROCESS_MONITOR_INTERVAL", "5000"), 10),
  agentKillTimeout: parseInt(optional("AGENT_KILL_TIMEOUT", "5000"), 10),
  nodeEnv: optional("NODE_ENV", "development"),
};
