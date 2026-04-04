import { createHash, randomBytes } from "crypto";
import { db } from "../index.js";
import { SYSTEM_KEY_SCOPES } from "../../constants/scopes.js";

export interface ApiKey {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  is_system: number;
  created_at: string;
  last_used_at: string | null;
  scopes: string | null;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  scopes: string[] | null;
}

/** Parse scopes from JSON string stored in DB, or return null. */
function parseScopes(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toPublic(key: ApiKey): ApiKeyPublic {
  return {
    id: key.id,
    name: key.name,
    key_prefix: key.key_prefix,
    created_at: key.created_at,
    last_used_at: key.last_used_at,
    scopes: parseScopes(key.scopes),
  };
}

export function listApiKeys(): ApiKeyPublic[] {
  return (
    db
      .prepare(
        "SELECT * FROM ApiKey WHERE is_system = 0 ORDER BY created_at DESC",
      )
      .all() as ApiKey[]
  ).map(toPublic);
}

export function getApiKeyById(id: string): ApiKey | null {
  return (
    (db.prepare("SELECT * FROM ApiKey WHERE id = ?").get(id) as ApiKey) ?? null
  );
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
export function createApiKey(
  name: string,
  isSystem = false,
  scopes?: string[],
): {
  apiKey: ApiKeyPublic;
  plaintext: string;
} {
  const id = crypto.randomUUID();
  const raw = `sk-${randomBytes(32).toString("hex")}`;
  const keyHash = hashKey(raw);
  const keyPrefix = raw.slice(0, 11); // sk- + 8 hex chars
  const scopesJson = scopes ? JSON.stringify(scopes) : null;

  db.prepare(
    "INSERT INTO ApiKey (id, name, key_hash, key_prefix, is_system, scopes) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, name, keyHash, keyPrefix, isSystem ? 1 : 0, scopesJson);

  return {
    apiKey: {
      id,
      name,
      key_prefix: keyPrefix,
      created_at: new Date().toISOString(),
      last_used_at: null,
      scopes: scopes ?? null,
    },
    plaintext: raw,
  };
}

export function deleteApiKey(id: string): boolean {
  const result = db.prepare("DELETE FROM ApiKey WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Check if a system key exists with is_system = 1.
 */
export function getSystemKey(): ApiKey | null {
  return (
    (db.prepare("SELECT * FROM ApiKey WHERE is_system = 1").get() as ApiKey) ??
    null
  );
}

/**
 * Ensure a system API key exists, always returning the raw key.
 * Deletes and recreates the system key on every call since the raw key
 * only lives in memory for the current server process lifetime.
 */
export function ensureSystemKey(): string {
  const existing = getSystemKey();
  if (existing) {
    db.prepare("DELETE FROM ApiKey WHERE id = ?").run(existing.id);
  }

  const { plaintext } = createApiKey("system", true, [...SYSTEM_KEY_SCOPES]);
  return plaintext;
}
