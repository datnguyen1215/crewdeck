import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import {
  listGitHubAccounts,
  getGitHubAccount,
  createGitHubAccount,
  deleteGitHubAccount,
} from "../../src/db/repositories/github-accounts.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Agent");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
  db.exec("DELETE FROM GitHubAccount");
}

beforeEach(clearAll);

const validInput = {
  account_name: "testuser",
  github_username: "testuser",
  oauth_token: "gho_abc123",
  scopes: "repo",
};

describe("createGitHubAccount", () => {
  it("creates an account and returns it with an id", () => {
    const account = createGitHubAccount(validInput);
    expect(account.id).toBeDefined();
    expect(account.account_name).toBe("testuser");
    expect(account.github_username).toBe("testuser");
    expect(account.oauth_token).toBe("gho_abc123");
    expect(account.scopes).toBe("repo");
    expect(account.created_at).toBeDefined();
  });

  it("stores null scopes when omitted", () => {
    const { scopes: _, ...noScopes } = validInput;
    const account = createGitHubAccount(noScopes);
    expect(account.scopes).toBeNull();
  });
});

describe("getGitHubAccount", () => {
  it("returns the account by id", () => {
    const created = createGitHubAccount(validInput);
    const found = getGitHubAccount(created.id);
    expect(found).toMatchObject({ id: created.id, github_username: "testuser" });
  });

  it("returns null for a missing id", () => {
    expect(getGitHubAccount("nonexistent")).toBeNull();
  });
});

describe("listGitHubAccounts", () => {
  it("returns all accounts", () => {
    createGitHubAccount({ ...validInput, account_name: "a" });
    createGitHubAccount({ ...validInput, account_name: "b" });
    const list = listGitHubAccounts();
    expect(list).toHaveLength(2);
    const names = list.map((a) => a.account_name).sort();
    expect(names).toEqual(["a", "b"]);
  });

  it("returns empty array when none exist", () => {
    expect(listGitHubAccounts()).toEqual([]);
  });
});

describe("deleteGitHubAccount", () => {
  it("removes the account", () => {
    const account = createGitHubAccount(validInput);
    deleteGitHubAccount(account.id);
    expect(getGitHubAccount(account.id)).toBeNull();
  });

  it("nullifies github_account_id on associated projects via ON DELETE SET NULL", () => {
    const account = createGitHubAccount(validInput);
    const project = createProject({ name: "P", github_account_id: account.id });
    expect(project.github_account_id).toBe(account.id);

    deleteGitHubAccount(account.id);

    const updated = db
      .prepare("SELECT github_account_id FROM Project WHERE id = ?")
      .get(project.id) as { github_account_id: string | null };
    expect(updated.github_account_id).toBeNull();
  });
});
