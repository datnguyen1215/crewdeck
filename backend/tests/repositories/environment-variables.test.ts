import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import {
  listEnvironmentVariables,
  getEnvironmentVariable,
  getEnvironmentVariableByKey,
  createEnvironmentVariable,
  updateEnvironmentVariable,
  deleteEnvironmentVariable,
  getEnvironmentVariablesMap,
} from "../../src/db/repositories/environment-variables.js";

function clearAll() {
  db.exec("DELETE FROM EnvironmentVariable");
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Agent");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("createEnvironmentVariable", () => {
  it("creates an env var with defaults", () => {
    const p = createProject({ name: "P" });
    const ev = createEnvironmentVariable(p.id, {
      key: "API_KEY",
      value: "abc123",
    });
    expect(ev.id).toBeTruthy();
    expect(ev.project_id).toBe(p.id);
    expect(ev.key).toBe("API_KEY");
    expect(ev.value).toBe("abc123");
    expect(ev.is_secret).toBe(false);
  });

  it("creates a secret env var", () => {
    const p = createProject({ name: "P" });
    const ev = createEnvironmentVariable(p.id, {
      key: "SECRET_KEY",
      value: "s3cret",
      is_secret: true,
    });
    expect(ev.is_secret).toBe(true);
  });

  it("rejects duplicate keys within the same project", () => {
    const p = createProject({ name: "P" });
    createEnvironmentVariable(p.id, { key: "KEY", value: "a" });
    expect(() =>
      createEnvironmentVariable(p.id, { key: "KEY", value: "b" }),
    ).toThrow();
  });

  it("allows same key in different projects", () => {
    const p1 = createProject({ name: "P1" });
    const p2 = createProject({ name: "P2" });
    const ev1 = createEnvironmentVariable(p1.id, { key: "KEY", value: "a" });
    const ev2 = createEnvironmentVariable(p2.id, { key: "KEY", value: "b" });
    expect(ev1.id).not.toBe(ev2.id);
  });
});

describe("listEnvironmentVariables", () => {
  it("returns vars for the project ordered by key", () => {
    const p = createProject({ name: "P" });
    createEnvironmentVariable(p.id, { key: "ZEBRA", value: "z" });
    createEnvironmentVariable(p.id, { key: "ALPHA", value: "a" });
    const vars = listEnvironmentVariables(p.id);
    expect(vars.length).toBe(2);
    expect(vars[0].key).toBe("ALPHA");
    expect(vars[1].key).toBe("ZEBRA");
  });

  it("does not return vars from other projects", () => {
    const p1 = createProject({ name: "P1" });
    const p2 = createProject({ name: "P2" });
    createEnvironmentVariable(p1.id, { key: "KEY", value: "v" });
    expect(listEnvironmentVariables(p2.id).length).toBe(0);
  });
});

describe("getEnvironmentVariable", () => {
  it("returns null for missing id", () => {
    expect(getEnvironmentVariable("missing")).toBeNull();
  });
});

describe("getEnvironmentVariableByKey", () => {
  it("finds by project and key", () => {
    const p = createProject({ name: "P" });
    const ev = createEnvironmentVariable(p.id, { key: "MY_KEY", value: "v" });
    const found = getEnvironmentVariableByKey(p.id, "MY_KEY");
    expect(found?.id).toBe(ev.id);
  });

  it("returns null for wrong project", () => {
    const p1 = createProject({ name: "P1" });
    const p2 = createProject({ name: "P2" });
    createEnvironmentVariable(p1.id, { key: "MY_KEY", value: "v" });
    expect(getEnvironmentVariableByKey(p2.id, "MY_KEY")).toBeNull();
  });
});

describe("updateEnvironmentVariable", () => {
  it("updates value and key", () => {
    const p = createProject({ name: "P" });
    const ev = createEnvironmentVariable(p.id, { key: "OLD", value: "old" });
    const updated = updateEnvironmentVariable(ev.id, {
      key: "NEW",
      value: "new",
    });
    expect(updated.key).toBe("NEW");
    expect(updated.value).toBe("new");
  });

  it("updates is_secret", () => {
    const p = createProject({ name: "P" });
    const ev = createEnvironmentVariable(p.id, { key: "K", value: "v" });
    expect(ev.is_secret).toBe(false);
    const updated = updateEnvironmentVariable(ev.id, { is_secret: true });
    expect(updated.is_secret).toBe(true);
  });
});

describe("deleteEnvironmentVariable", () => {
  it("deletes the env var", () => {
    const p = createProject({ name: "P" });
    const ev = createEnvironmentVariable(p.id, { key: "K", value: "v" });
    deleteEnvironmentVariable(ev.id);
    expect(getEnvironmentVariable(ev.id)).toBeNull();
  });
});

describe("getEnvironmentVariablesMap", () => {
  it("returns a key-value map", () => {
    const p = createProject({ name: "P" });
    createEnvironmentVariable(p.id, { key: "A", value: "1" });
    createEnvironmentVariable(p.id, { key: "B", value: "2" });
    const map = getEnvironmentVariablesMap(p.id);
    expect(map).toEqual({ A: "1", B: "2" });
  });

  it("returns empty object for project with no vars", () => {
    const p = createProject({ name: "P" });
    expect(getEnvironmentVariablesMap(p.id)).toEqual({});
  });
});
