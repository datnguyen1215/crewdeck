import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import {
  listVCSAccounts,
  getVCSAccount,
  createVCSAccount,
  deleteVCSAccount,
} from "../../src/db/repositories/vcs-accounts.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
  db.exec("DELETE FROM VCSAccount");
}

beforeEach(clearAll);

const validInput = {
  account_name: "testuser",
  username: "testuser",
  token: "gho_abc123",
  ssh_private_key:
    "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----",
};

describe("createVCSAccount", () => {
  it("creates an account and returns it with an id", () => {
    const account = createVCSAccount(validInput);
    expect(account.id).toBeDefined();
    expect(account.account_name).toBe("testuser");
    expect(account.username).toBe("testuser");
    expect(account.token).toBe("gho_abc123");
    expect(account.ssh_private_key).toBeDefined();
    expect(account.created_at).toBeDefined();
  });
});

describe("getVCSAccount", () => {
  it("returns the account by id", () => {
    const created = createVCSAccount(validInput);
    const found = getVCSAccount(created.id);
    expect(found).toMatchObject({
      id: created.id,
      username: "testuser",
    });
  });

  it("returns null for a missing id", () => {
    expect(getVCSAccount("nonexistent")).toBeNull();
  });
});

describe("listVCSAccounts", () => {
  it("returns all accounts", () => {
    createVCSAccount({ ...validInput, account_name: "a" });
    createVCSAccount({ ...validInput, account_name: "b" });
    const list = listVCSAccounts();
    expect(list).toHaveLength(2);
    const names = list.map((a) => a.account_name).sort();
    expect(names).toEqual(["a", "b"]);
  });

  it("returns empty array when none exist", () => {
    expect(listVCSAccounts()).toEqual([]);
  });
});

describe("deleteVCSAccount", () => {
  it("removes the account", () => {
    const account = createVCSAccount(validInput);
    deleteVCSAccount(account.id);
    expect(getVCSAccount(account.id)).toBeNull();
  });

  it("nullifies vcs_account_id on associated projects via ON DELETE SET NULL", () => {
    const account = createVCSAccount(validInput);
    const project = createProject({ name: "P", vcs_account_id: account.id });
    expect(project.vcs_account_id).toBe(account.id);

    deleteVCSAccount(account.id);

    const updated = db
      .prepare("SELECT vcs_account_id FROM Project WHERE id = ?")
      .get(project.id) as { vcs_account_id: string | null };
    expect(updated.vcs_account_id).toBeNull();
  });
});
