import type { Response } from "express";
import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { config } from "../config.js";
import {
  adminExists,
  getAdminByUsername,
  createAdmin,
  createSession,
  deleteSession,
  markSetupComplete,
} from "../db/repositories/auth.js";
import { validate } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { ConflictError, ForbiddenError } from "../middleware/errors.js";
const BCRYPT_ROUNDS = 12;

const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.nodeEnv === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: TEN_YEARS_MS,
};

// In-memory rate limiter for login attempts.
// Note: req.ip is only correct behind a reverse proxy when Express
// `trust proxy` is enabled (configured in app.ts via TRUST_PROXY env).
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();

  // Prune stale entries to prevent unbounded memory growth
  for (const [key, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(key);
  }

  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  entry.count++;
  return entry.count <= 5;
}

function setSessionCookie(res: Response, userId: string) {
  const session = createSession(userId);
  res.cookie("session_token", session.id, COOKIE_OPTIONS);
  return session;
}

// GET /setup-status — check if admin account exists
router.get("/setup-status", (_req, res) => {
  res.json({ needsSetup: !adminExists() });
});

// POST /setup — create admin account (only when no admin exists)
const SetupSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(8),
});

router.post("/setup", validate(SetupSchema), async (req, res, next) => {
  try {
    if (adminExists()) {
      throw new ConflictError("Admin account already exists");
    }
    const { username, password } = req.body;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const admin = createAdmin(username, passwordHash);
    setSessionCookie(res, admin.id);
    res.status(201).json({ id: admin.id, username: admin.username });
  } catch (err) {
    next(err);
  }
});

// POST /login — authenticate and create session
const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/login", validate(LoginSchema), async (req, res, next) => {
  try {
    const ip = req.ip ?? "unknown";
    if (!checkRateLimit(ip)) {
      next(
        new ForbiddenError("Too many login attempts. Try again in a minute."),
      );
      return;
    }

    const { username, password } = req.body;
    const admin = getAdminByUsername(username);
    if (!admin) {
      throw new ForbiddenError("Invalid credentials");
    }

    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) {
      throw new ForbiddenError("Invalid credentials");
    }

    setSessionCookie(res, admin.id);
    res.json({ id: admin.id, username: admin.username });
  } catch (err) {
    next(err);
  }
});

// POST /logout — delete session and clear cookie
router.post("/logout", (req, res) => {
  const token = req.cookies?.session_token;
  if (token) deleteSession(token);
  res.clearCookie("session_token", { path: "/" });
  res.json({ ok: true });
});

// GET /me — return current session info
router.get("/me", requireAuth, (req, res) => {
  res.json({
    id: req.session!.userId,
    username: req.session!.username,
    setupCompleted: req.session!.setupCompleted === 1,
  });
});

// POST /complete-setup — mark setup as completed
router.post("/complete-setup", requireAuth, (req, res) => {
  markSetupComplete(req.session!.userId);
  req.session!.setupCompleted = 1;
  res.json({ ok: true });
});

export default router;
