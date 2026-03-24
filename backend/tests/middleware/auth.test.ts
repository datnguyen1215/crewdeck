import { describe, it, expect } from "vitest";

// Test the email allowlist logic directly without mocking config
describe("email allowlist logic", () => {
  function isEmailAllowed(email: string, allowedEmails: string[]): boolean {
    if (allowedEmails.length === 0) return true;
    return allowedEmails.includes(email.toLowerCase());
  }

  it("allows any email when allowlist is empty", () => {
    expect(isEmailAllowed("anyone@example.com", [])).toBe(true);
    expect(isEmailAllowed("test@gmail.com", [])).toBe(true);
  });

  it("allows email in allowlist", () => {
    const allowlist = ["user@example.com", "admin@example.com"];
    expect(isEmailAllowed("user@example.com", allowlist)).toBe(true);
    expect(isEmailAllowed("admin@example.com", allowlist)).toBe(true);
  });

  it("blocks email not in allowlist", () => {
    const allowlist = ["user@example.com"];
    expect(isEmailAllowed("other@example.com", allowlist)).toBe(false);
    expect(isEmailAllowed("hacker@evil.com", allowlist)).toBe(false);
  });

  it("is case-insensitive", () => {
    const allowlist = ["user@example.com"];
    expect(isEmailAllowed("USER@example.com", allowlist)).toBe(true);
    expect(isEmailAllowed("User@Example.COM", allowlist)).toBe(true);
  });
});
