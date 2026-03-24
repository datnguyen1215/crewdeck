import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isEmailAllowed } from "../../src/middleware/auth.js";
import { config } from "../../src/config.js";

describe("isEmailAllowed", () => {
  let originalAllowedEmails: string[];

  beforeEach(() => {
    originalAllowedEmails = [...config.allowedEmails];
  });

  afterEach(() => {
    config.allowedEmails = originalAllowedEmails;
  });

  it("allows any email when allowlist is empty", () => {
    config.allowedEmails = [];
    expect(isEmailAllowed("anyone@example.com")).toBe(true);
    expect(isEmailAllowed("test@gmail.com")).toBe(true);
  });

  it("allows email in allowlist", () => {
    config.allowedEmails = ["user@example.com", "admin@example.com"];
    expect(isEmailAllowed("user@example.com")).toBe(true);
    expect(isEmailAllowed("admin@example.com")).toBe(true);
  });

  it("blocks email not in allowlist", () => {
    config.allowedEmails = ["user@example.com"];
    expect(isEmailAllowed("other@example.com")).toBe(false);
    expect(isEmailAllowed("hacker@evil.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    config.allowedEmails = ["user@example.com"];
    expect(isEmailAllowed("USER@example.com")).toBe(true);
    expect(isEmailAllowed("User@Example.COM")).toBe(true);
  });
});
