import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { config } from "../config.js";
import { UnauthorizedError } from "./errors.js";

export interface Session {
  email: string;
  name?: string;
  picture?: string;
}

// In-memory session store (keyed by session ID)
const sessions = new Map<string, Session>();

// Cookie name for the session
const SESSION_COOKIE = "crewdeck_session";

/**
 * Parse session cookie and return session if valid
 */
export function getSession(req: Request): Session | null {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId) return null;
  return sessions.get(sessionId) ?? null;
}

/**
 * Create a new session and set cookie
 */
export function createSession(res: Response, session: Session): void {
  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, session);
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/**
 * Destroy session and clear cookie
 */
export function destroySession(req: Request, res: Response): void {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.clearCookie(SESSION_COOKIE);
}

/**
 * Check if email is in the allowlist (if configured)
 */
export function isEmailAllowed(email: string): boolean {
  if (config.allowedEmails.length === 0) return true;
  return config.allowedEmails.includes(email.toLowerCase());
}

/**
 * Auth middleware - requires valid session for protected routes
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session) {
    throw new UnauthorizedError();
  }
  // Attach session to request for downstream use
  (req as Request & { session: Session }).session = session;
  next();
}

/**
 * Skip auth for specific paths (auth routes, health check)
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;

  // Skip auth for auth routes and health check
  if (path === "/auth" || path.startsWith("/auth/") || path === "/health") {
    return next();
  }

  // Skip auth for WebSocket upgrade requests (ws handles its own auth via cookie)
  if (req.headers.upgrade === "websocket") {
    return next();
  }

  requireAuth(req, res, next);
}
