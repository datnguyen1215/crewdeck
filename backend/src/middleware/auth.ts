import { createHash } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getSession, type Session } from "../db/repositories/auth.js";
import { getByKeyHash, updateLastUsed, parseScopes } from "../db/repositories/api-keys.js";
import { ForbiddenError } from "./errors.js";

declare global {
  namespace Express {
    interface Request {
      session?: { token: string; userId: string; username: string; setupCompleted: number };
      apiKey?: {
        id: string;
        name: string;
        isSystem: boolean;
        scopes: string[] | null; // null = unrestricted
      };
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
): { id: string; username: string; apiKey: NonNullable<Request["apiKey"]> } | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  const key = header.slice(7);
  if (!key.startsWith("sk-")) return null;

  const hash = createHash("sha256").update(key).digest("hex");
  const apiKeyRow = getByKeyHash(hash);
  if (!apiKeyRow) return null;

  // Throttle last_used_at updates to at most once per minute
  if (
    !apiKeyRow.last_used_at ||
    Date.now() - new Date(apiKeyRow.last_used_at).getTime() > 60_000
  ) {
    updateLastUsed(apiKeyRow.id);
  }

  return {
    id: apiKeyRow.id,
    username: `api-key:${apiKeyRow.name}`,
    apiKey: {
      id: apiKeyRow.id,
      name: apiKeyRow.name,
      isSystem: !!apiKeyRow.is_system,
      scopes: parseScopes(apiKeyRow.scopes),
    },
  };
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Try Bearer token first
  const apiKeyAuth = authenticateViaApiKey(req);
  if (apiKeyAuth) {
    req.session = {
      token: apiKeyAuth.id,
      userId: apiKeyAuth.id,
      username: apiKeyAuth.username,
      setupCompleted: 1,
    };
    req.apiKey = apiKeyAuth.apiKey;
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
