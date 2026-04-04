import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getSession, type Session } from "../db/repositories/auth.js";
import { getByKeyHash, updateLastUsed } from "../db/repositories/api-keys.js";
import { ForbiddenError } from "./errors.js";

declare global {
  namespace Express {
    interface Request {
      session?: { token: string; userId: string; username: string; setupCompleted: number };
    }
  }
}

/**
 * Validate a session token from a raw Cookie header string.
 * Used by both HTTP middleware and WebSocket upgrade handlers.
 */
export function validateSessionFromCookie(
  cookieHeader: string | undefined,
): (Session & { username: string; setup_completed: number }) | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)session_token=([^;]*)/.exec(cookieHeader);
  if (!match) return null;
  return getSession(match[1]);
}

function authenticateViaApiKey(
  req: Request,
): { id: string; username: string } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  const key = header.slice(7);
  if (!key.startsWith("sk-")) return null;

  const hash = createHash("sha256").update(key).digest("hex");
  const apiKey = getByKeyHash(hash);
  if (!apiKey) return null;

  // Throttle last_used_at updates to at most once per minute
  if (
    !apiKey.last_used_at ||
    Date.now() - new Date(apiKey.last_used_at).getTime() > 60_000
  ) {
    updateLastUsed(apiKey.id);
  }

  return { id: apiKey.id, username: `api-key:${apiKey.name}` };
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Try Bearer token first
  const apiKey = authenticateViaApiKey(req);
  if (apiKey) {
    req.session = {
      token: apiKey.id,
      userId: apiKey.id,
      username: apiKey.username,
      setupCompleted: 1,
    };
    next();
    return;
  }

  // Fall back to session cookie
  const token = req.cookies?.session_token;
  if (!token) {
    next(new ForbiddenError("Authentication required"));
    return;
  }

  const session = getSession(token);
  if (!session) {
    next(new ForbiddenError("Invalid or expired session"));
    return;
  }

  req.session = {
    token: session.id,
    userId: session.user_id,
    username: session.username,
    setupCompleted: session.setup_completed,
  };
  next();
}
