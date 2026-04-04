import { db } from "../index.js";

const DEFAULT_MODEL = "sonnet";
const DEFAULT_MAX_CONCURRENCY = 5;
const DEFAULT_MAX_CHAIN_DEPTH = 20;
const DEFAULT_AGENT_TIMEOUT_MINUTES = 10;

function getConfig(key: string, fallback: string): string {
  const row = db
    .prepare("SELECT value FROM GlobalConfig WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function setConfig(key: string, value: string): void {
  db.prepare(
    `INSERT INTO GlobalConfig (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getDefaultModel(): string {
  return getConfig("default_model", DEFAULT_MODEL);
}

export function setDefaultModel(model: string): void {
  setConfig("default_model", model);
}

export function getMaxConcurrency(): number {
  return Number(getConfig("max_concurrency", String(DEFAULT_MAX_CONCURRENCY)));
}

export function setMaxConcurrency(value: number): void {
  setConfig("max_concurrency", String(value));
}

export function getMaxChainDepth(): number {
  return Number(getConfig("max_chain_depth", String(DEFAULT_MAX_CHAIN_DEPTH)));
}

export function setMaxChainDepth(value: number): void {
  setConfig("max_chain_depth", String(value));
}

export function getAgentTimeoutMinutes(): number {
  return Number(
    getConfig("agent_timeout_minutes", String(DEFAULT_AGENT_TIMEOUT_MINUTES)),
  );
}

export function setAgentTimeoutMinutes(value: number): void {
  setConfig("agent_timeout_minutes", String(value));
}
