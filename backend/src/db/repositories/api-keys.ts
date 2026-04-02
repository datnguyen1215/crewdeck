import { createHash, randomBytes } from "crypto";
import { db } from "../index.js";

export interface ApiKey {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

function toPublic(key: ApiKey): ApiKeyPublic {
  return {
    id: key.id,
    name: key.name,
    key_prefix: key.key_prefix,
    created_at: key.created_at,
    last_used_at: key.last_used_at,
  };
}

export function listApiKeys(): ApiKeyPublic[] {
  return (
    db
      .prepare("SELECT * FROM ApiKey ORDER BY created_at DESC")
      .all() as ApiKey[]
  ).map(toPublic);
}

export function getByKeyHash(hash: string): ApiKey | null {
  return (
    (db
      .prepare("SELECT * FROM ApiKey WHERE key_hash = ?")
      .get(hash) as ApiKey) ?? null
  );
}

export function updateLastUsed(id: string): void {
  db.prepare(
    "UPDATE ApiKey SET last_used_at = datetime('now') WHERE id = ?",
  ).run(id);
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Creates a new API key. Returns the full plaintext key (only shown once).
 */
export function createApiKey(name: string): {
  apiKey: ApiKeyPublic;
  plaintext: string;
} {
  const id = crypto.randomUUID();
  const raw = `sk-${randomBytes(32).toString("hex")}`;
  const keyHash = hashKey(raw);
  const keyPrefix = raw.slice(0, 12); // sk- + 8 hex chars

  db.prepare(
    "INSERT INTO ApiKey (id, name, key_hash, key_prefix) VALUES (?, ?, ?, ?)",
  ).run(id, name, keyHash, keyPrefix);

  return {
    apiKey: {
      id,
      name,
      key_prefix: keyPrefix,
      created_at: new Date().toISOString(),
      last_used_at: null,
    },
    plaintext: raw,
  };
}

export function deleteApiKey(id: string): boolean {
  const result = db.prepare("DELETE FROM ApiKey WHERE id = ?").run(id);
  return result.changes > 0;
}
