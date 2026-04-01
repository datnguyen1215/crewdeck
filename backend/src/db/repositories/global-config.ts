import { db } from "../index.js";

export type Provider = "claude" | "glm";

export function getProvider(): Provider {
  const row = db
    .prepare("SELECT value FROM GlobalConfig WHERE key = ?")
    .get("provider") as { value: string } | undefined;
  return (row?.value as Provider) ?? "claude";
}

export function setProvider(provider: Provider): void {
  db.prepare(
    `INSERT INTO GlobalConfig (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run("provider", provider);
}

export function getZaiApiKey(): string | null {
  const row = db
    .prepare("SELECT value FROM GlobalConfig WHERE key = ?")
    .get("zai_api_key") as { value: string } | undefined;
  return row?.value ?? null;
}

export function setZaiApiKey(key: string | null): void {
  if (key === null) {
    db.prepare("DELETE FROM GlobalConfig WHERE key = ?").run("zai_api_key");
  } else {
    db.prepare(
      `INSERT INTO GlobalConfig (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run("zai_api_key", key);
  }
}
