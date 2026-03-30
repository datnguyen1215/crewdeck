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
