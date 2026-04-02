import type { Request, Response, NextFunction } from "express";
import { getSession, cleanExpiredSessions } from "../db/repositories/auth.js";
import { ForbiddenError } from "./errors.js";

declare global {
  namespace Express {
    interface Request {
      session?: { token: string; userId: string; username: string };
    }
  }
}

// Periodically clean expired sessions (roughly every 10 minutes)
let lastCleanup = 0;
function maybeCleanSessions(): void {
  const now = Date.now();
  if (now - lastCleanup > 10 * 60 * 1000) {
    lastCleanup = now;
    cleanExpiredSessions();
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  maybeCleanSessions();

  const token = req.cookies?.session_token;
  if (!token) {
    // 403 rather than 401: the client presented no credentials at all, so
    // there is nothing to authenticate — the server simply refuses access.
    next(new ForbiddenError("Authentication required"));
    return;
  }

  const session = getSession(token);
  if (!session) {
    // 403: a token was present but invalid/expired — the server understood
    // the credentials but refuses to authorize them.
    next(new ForbiddenError("Invalid or expired session"));
    return;
  }

  req.session = {
    token: session.id,
    userId: session.user_id,
    username: session.username,
  };
  next();
}
