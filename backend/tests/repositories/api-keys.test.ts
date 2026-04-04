import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import {
  createApiKey,
  listApiKeys,
  getSystemKey,
  ensureSystemKey,
  deleteApiKey,
} from "../../src/db/repositories/api-keys.js";
import { SYSTEM_KEY_SCOPES, ApiKeyScope } from "../../src/constants/scopes.js";

function clearAll() {
  db.exec("DELETE FROM ApiKey");
}

beforeEach(clearAll);

describe("createApiKey", () => {
  it("creates key with null scopes when no scopes provided", () => {
    const { apiKey, plaintext } = createApiKey("test");
    expect(apiKey.name).toBe("test");
    expect(apiKey.scopes).toBeNull();
    expect(plaintext).toMatch(/^sk-/);
  });

  it("creates key with provided scopes", () => {
    const scopes = [ApiKeyScope.ISSUES_READ, ApiKeyScope.COMMENTS_WRITE];
    const { apiKey } = createApiKey("scoped", false, scopes);
    expect(apiKey.scopes).toEqual(scopes);
  });

  it("creates system key with scopes", () => {
    const { apiKey } = createApiKey("system", true, SYSTEM_KEY_SCOPES);
    expect(apiKey.scopes).toEqual([...SYSTEM_KEY_SCOPES]);
  });
});

describe("listApiKeys", () => {
  it("includes scopes in listing", () => {
    createApiKey("unscoped");
    createApiKey("scoped", false, [ApiKeyScope.ISSUES_READ]);

    const keys = listApiKeys();
    expect(keys).toHaveLength(2);

    const unscoped = keys.find((k) => k.name === "unscoped");
    const scoped = keys.find((k) => k.name === "scoped");
    expect(unscoped!.scopes).toBeNull();
    expect(scoped!.scopes).toEqual([ApiKeyScope.ISSUES_READ]);
  });

  it("excludes system keys from listing", () => {
    createApiKey("user-key");
    createApiKey("system", true);

    const keys = listApiKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0].name).toBe("user-key");
  });
});

describe("ensureSystemKey", () => {
  it("creates system key with SYSTEM_KEY_SCOPES", () => {
    const plaintext = ensureSystemKey();
    expect(plaintext).toMatch(/^sk-/);

    const sysKey = getSystemKey();
    expect(sysKey).not.toBeNull();
    const scopes = sysKey!.scopes ? JSON.parse(sysKey!.scopes) : null;
    expect(scopes).toEqual([...SYSTEM_KEY_SCOPES]);
  });

  it("recreates system key on each call", () => {
    const first = ensureSystemKey();
    const second = ensureSystemKey();
    expect(first).not.toBe(second);

    const sysKey = getSystemKey();
    expect(sysKey).not.toBeNull();
  });
});

describe("deleteApiKey", () => {
  it("deletes a key by id", () => {
    const { apiKey } = createApiKey("to-delete");
    expect(listApiKeys()).toHaveLength(1);

    deleteApiKey(apiKey.id);
    expect(listApiKeys()).toHaveLength(0);
  });
});
