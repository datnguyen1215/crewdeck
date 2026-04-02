import { db } from "../index.js";

const DEFAULT_MODEL = "sonnet";

export function getDefaultModel(): string {
  const row = db
    .prepare("SELECT value FROM GlobalConfig WHERE key = ?")
    .get("default_model") as { value: string } | undefined;
  return row?.value ?? DEFAULT_MODEL;
}

export function setDefaultModel(model: string): void {
  db.prepare(
    `INSERT INTO GlobalConfig (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run("default_model", model);
}
