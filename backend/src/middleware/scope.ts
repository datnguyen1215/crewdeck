import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "./errors.js";

/**
 * Middleware factory that enforces scope-based authorization.
 * Session-authenticated users (admin) always pass.
 * API keys with null scopes (unrestricted) always pass.
 * Otherwise, ALL required scopes must be present on the key.
 */
export function requireScope(...requiredScopes: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      next();
      return;
    }

    if (req.apiKey.scopes === null) {
      next();
      return;
    }

    const missing = requiredScopes.filter((s) => !req.apiKey!.scopes!.includes(s));
    if (missing.length > 0) {
      next(new ForbiddenError(`Insufficient scope. Missing: ${missing.join(", ")}`));
      return;
    }

    next();
  };
}
