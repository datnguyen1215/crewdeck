import { describe, it, expect, vi } from "vitest";
import { requireScope } from "../../src/middleware/scope.js";
import { ForbiddenError } from "../../src/middleware/errors.js";
import type { Request, Response, NextFunction } from "express";

function makeReq(apiKey?: Request["apiKey"]): Request {
  return { apiKey } as unknown as Request;
}

const res = {} as Response;
const next = vi.fn();

describe("requireScope", () => {
  beforeEach(() => {
    next.mockClear();
  });

  it("passes when req.apiKey is undefined (session auth)", () => {
    requireScope("read")(
      makeReq(undefined),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("passes when apiKey.scopes is null (unrestricted)", () => {
    requireScope("read", "write")(
      makeReq({ id: "1", name: "key", isSystem: false, scopes: null }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("passes when apiKey has all required scopes", () => {
    requireScope("read", "write")(
      makeReq({ id: "1", name: "key", isSystem: false, scopes: ["read", "write", "admin"] }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("blocks when apiKey is missing a required scope", () => {
    requireScope("read", "write")(
      makeReq({ id: "1", name: "key", isSystem: false, scopes: ["read"] }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Insufficient scope. Missing: write",
      }),
    );
    expect(next.mock.calls[0][0]).toBeInstanceOf(ForbiddenError);
  });

  it("blocks when apiKey has empty scopes array", () => {
    requireScope("read")(
      makeReq({ id: "1", name: "key", isSystem: false, scopes: [] }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Insufficient scope. Missing: read",
      }),
    );
  });

  it("lists all missing scopes in error message", () => {
    requireScope("read", "write", "admin")(
      makeReq({ id: "1", name: "key", isSystem: false, scopes: [] }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Insufficient scope. Missing: read, write, admin",
      }),
    );
  });

  it("passes with single required scope when apiKey has it", () => {
    requireScope("read")(
      makeReq({ id: "1", name: "key", isSystem: false, scopes: ["read"] }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });
});
