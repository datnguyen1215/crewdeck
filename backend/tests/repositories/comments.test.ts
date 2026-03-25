import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/index.js";
import { createProject } from "../../src/db/repositories/projects.js";
import { createIssue } from "../../src/db/repositories/issues.js";
import { listComments, getComment, createComment } from "../../src/db/repositories/comments.js";

function clearAll() {
  db.exec("DELETE FROM ActivityLog");
  db.exec("DELETE FROM IssuePR");
  db.exec("DELETE FROM Comment");
  db.exec("DELETE FROM Issue");
  db.exec("DELETE FROM Repo");
  db.exec("DELETE FROM Project");
}

beforeEach(clearAll);

describe("createComment", () => {
  it("creates a comment with defaults", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const comment = createComment(issue.id, { content: "Hello" });
    expect(comment.id).toBeTruthy();
    expect(comment.content).toBe("Hello");
    expect(comment.author_type).toBe("user");
  });

  it("creates a comment with agent author_type", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    const comment = createComment(issue.id, {
      content: "Agent says hi",
      author_type: "engineer",
    });
    expect(comment.author_type).toBe("engineer");
  });
});

describe("listComments", () => {
  it("returns comments in order", () => {
    const p = createProject({ name: "P" });
    const issue = createIssue(p.id, { title: "T", description: "D" });
    createComment(issue.id, { content: "First" });
    createComment(issue.id, { content: "Second" });
    const comments = listComments(issue.id);
    expect(comments.length).toBe(2);
    expect(comments[0].content).toBe("First");
  });
});

describe("getComment", () => {
  it("returns null for missing id", () => {
    expect(getComment("missing")).toBeNull();
  });
});
