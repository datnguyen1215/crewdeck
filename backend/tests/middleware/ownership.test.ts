import { describe, it, expect } from "vitest";
import { createOwnershipVerifier } from "../../src/middleware/ownership.js";
import { NotFoundError } from "../../src/middleware/errors.js";

describe("createOwnershipVerifier", () => {
  it("returns entity when it exists and ownership matches", () => {
    const getter = (id: string) => ({ id, project_id: "proj-1", name: "Test" });
    const verify = createOwnershipVerifier(getter, "Item", "project_id");

    const result = verify("item-1", "proj-1");
    expect(result).toEqual({ id: "item-1", project_id: "proj-1", name: "Test" });
  });

  it("throws NotFoundError when entity does not exist", () => {
    const getter = () => null;
    const verify = createOwnershipVerifier(getter, "Item", "project_id");

    expect(() => verify("item-1", "proj-1")).toThrow(NotFoundError);
    expect(() => verify("item-1", "proj-1")).toThrow("Item not found");
  });

  it("throws NotFoundError when ownership does not match", () => {
    const getter = (id: string) => ({ id, project_id: "proj-other", name: "Test" });
    const verify = createOwnershipVerifier(getter, "Item", "project_id");

    expect(() => verify("item-1", "proj-1")).toThrow(NotFoundError);
    expect(() => verify("item-1", "proj-1")).toThrow("Item not found");
  });

  it("works with different owner keys", () => {
    const getter = (id: string) => ({ id, issue_id: "issue-1", text: "comment" });
    const verify = createOwnershipVerifier(getter, "Comment", "issue_id");

    const result = verify("comment-1", "issue-1");
    expect(result.issue_id).toBe("issue-1");

    expect(() => verify("comment-1", "issue-wrong")).toThrow("Comment not found");
  });
});
