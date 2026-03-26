import { describe, it, expect } from "vitest";
import { parsePRUrls } from "../../src/pr/detector.js";

describe("parsePRUrls", () => {
  describe("standard GitHub PR URLs", () => {
    it("parses a single PR URL", () => {
      const content = "Check out https://github.com/acme/repo/pull/123";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        owner: "acme",
        name: "repo",
        prNumber: 123,
        url: "https://github.com/acme/repo/pull/123",
      });
    });

    it("parses PR URLs with hyphens in owner/repo names", () => {
      const content = "See https://github.com/my-org/my-repo-name/pull/456";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        owner: "my-org",
        name: "my-repo-name",
        prNumber: 456,
        url: "https://github.com/my-org/my-repo-name/pull/456",
      });
    });

    it("parses PR URLs with underscores in names", () => {
      const content = "https://github.com/org_name/repo_name/pull/789";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].owner).toBe("org_name");
      expect(result[0].name).toBe("repo_name");
    });

    it("parses PR URLs with numbers in names", () => {
      const content = "https://github.com/user123/repo456/pull/1";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].owner).toBe("user123");
      expect(result[0].name).toBe("repo456");
    });
  });

  describe("multiple URLs in content", () => {
    it("parses multiple PR URLs in one comment", () => {
      const content = `I've created two PRs:
        - https://github.com/acme/frontend/pull/10
        - https://github.com/acme/backend/pull/20`;

      const result = parsePRUrls(content);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        owner: "acme",
        name: "frontend",
        prNumber: 10,
        url: "https://github.com/acme/frontend/pull/10",
      });
      expect(result[1]).toEqual({
        owner: "acme",
        name: "backend",
        prNumber: 20,
        url: "https://github.com/acme/backend/pull/20",
      });
    });

    it("parses PRs from same repo with different numbers", () => {
      const content = `Related PRs: https://github.com/org/repo/pull/1 and https://github.com/org/repo/pull/2`;
      const result = parsePRUrls(content);

      expect(result).toHaveLength(2);
      expect(result[0].prNumber).toBe(1);
      expect(result[1].prNumber).toBe(2);
    });
  });

  describe("no URLs in content", () => {
    it("returns empty array for text without URLs", () => {
      const content = "This is just a regular comment with no links.";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      const result = parsePRUrls("");
      expect(result).toEqual([]);
    });

    it("returns empty array for whitespace only", () => {
      const result = parsePRUrls("   \n\t  ");
      expect(result).toEqual([]);
    });
  });

  describe("malformed/partial URLs", () => {
    it("does not match HTTP (non-HTTPS) URLs", () => {
      const content = "http://github.com/acme/repo/pull/123";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });

    it("does not match GitHub issue URLs", () => {
      const content = "https://github.com/acme/repo/issues/123";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });

    it("does not match GitHub commit URLs", () => {
      const content = "https://github.com/acme/repo/commit/abc123";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });

    it("does not match non-GitHub URLs", () => {
      const content = "https://gitlab.com/acme/repo/pull/123";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });

    it("does not match incomplete PR URLs", () => {
      const content = "https://github.com/acme/repo/pull/";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });

    it("does not match URLs without PR number", () => {
      const content = "https://github.com/acme/repo/pull";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });

    it("does not match repo URLs without /pull path", () => {
      const content = "https://github.com/acme/repo";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });
  });

  describe("URLs with trailing content", () => {
    it("extracts URL ending with period", () => {
      const content = "Check this PR: https://github.com/acme/repo/pull/123.";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://github.com/acme/repo/pull/123");
    });

    it("extracts URL ending with comma", () => {
      const content = "See https://github.com/acme/repo/pull/123, it's important";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://github.com/acme/repo/pull/123");
    });

    it("extracts URL ending with parenthesis", () => {
      const content = "(https://github.com/acme/repo/pull/123)";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://github.com/acme/repo/pull/123");
    });

    it("extracts URL ending with newline", () => {
      const content = "PR: https://github.com/acme/repo/pull/123\nThanks!";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://github.com/acme/repo/pull/123");
    });
  });

  describe("URLs with query parameters or fragments", () => {
    it("extracts base URL without query params", () => {
      // The regex stops at the PR number, so query params are not included
      const content = "https://github.com/acme/repo/pull/123?diff=split";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://github.com/acme/repo/pull/123");
      expect(result[0].prNumber).toBe(123);
    });

    it("extracts base URL without fragments", () => {
      const content = "https://github.com/acme/repo/pull/123#discussion_r12345";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://github.com/acme/repo/pull/123");
    });

    it("handles /files path after PR number", () => {
      const content = "https://github.com/acme/repo/pull/123/files";
      const result = parsePRUrls(content);

      // Regex captures up to the PR number only
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe("https://github.com/acme/repo/pull/123");
    });
  });

  describe("case sensitivity", () => {
    it("matches github.com in lowercase only", () => {
      const content = "https://GITHUB.COM/acme/repo/pull/123";
      const result = parsePRUrls(content);
      expect(result).toEqual([]);
    });
  });

  describe("embedded in markdown", () => {
    it("parses URL from markdown link", () => {
      const content = "Check [this PR](https://github.com/acme/repo/pull/123)";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].prNumber).toBe(123);
    });

    it("parses URL from bare markdown link", () => {
      const content = "<https://github.com/acme/repo/pull/456>";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].prNumber).toBe(456);
    });
  });

  describe("large PR numbers", () => {
    it("parses PRs with large numbers", () => {
      const content = "https://github.com/acme/repo/pull/99999";
      const result = parsePRUrls(content);

      expect(result).toHaveLength(1);
      expect(result[0].prNumber).toBe(99999);
    });
  });

  describe("repeated calls (regex state reset)", () => {
    it("correctly parses on repeated calls", () => {
      // Ensures the global regex lastIndex is reset between calls
      const content1 = "https://github.com/a/b/pull/1";
      const content2 = "https://github.com/c/d/pull/2";

      const result1 = parsePRUrls(content1);
      const result2 = parsePRUrls(content2);

      expect(result1).toHaveLength(1);
      expect(result1[0].prNumber).toBe(1);
      expect(result2).toHaveLength(1);
      expect(result2[0].prNumber).toBe(2);
    });
  });
});
