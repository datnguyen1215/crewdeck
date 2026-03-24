import { Router } from "express";
import { config } from "../config.js";
import { createSession, destroySession, getSession, isEmailAllowed } from "../middleware/auth.js";
import { ForbiddenError, ValidationError } from "../middleware/errors.js";
import { logger } from "../logger.js";

const router = Router();

// Google OAuth URLs
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * GET /auth/google - Redirect to Google OAuth consent screen
 */
router.get("/google", (req, res) => {
  if (!config.googleClientId) {
    throw new ValidationError("Google OAuth not configured");
  }

  const redirectUri = `${req.protocol}://${req.get("host")}/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

/**
 * GET /auth/google/callback - Handle OAuth callback
 */
router.get("/google/callback", async (req, res, next) => {
  try {
    const { code, error } = req.query;

    if (error) {
      logger.warn({ error }, "Google OAuth error");
      return res.redirect("/login?error=oauth_denied");
    }

    if (!code || typeof code !== "string") {
      return res.redirect("/login?error=missing_code");
    }

    const redirectUri = `${req.protocol}://${req.get("host")}/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      logger.error({ status: tokenRes.status, body: errBody }, "Failed to exchange code for token");
      return res.redirect("/login?error=token_exchange_failed");
    }

    const tokens = (await tokenRes.json()) as { access_token: string };

    // Get user info
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userRes.ok) {
      logger.error({ status: userRes.status }, "Failed to fetch user info");
      return res.redirect("/login?error=userinfo_failed");
    }

    const user = (await userRes.json()) as { email: string; name?: string; picture?: string };

    if (!user.email) {
      return res.redirect("/login?error=no_email");
    }

    // Check allowlist
    if (!isEmailAllowed(user.email)) {
      logger.warn({ email: user.email }, "Login denied - email not in allowlist");
      return res.redirect("/login?error=not_allowed");
    }

    // Create session
    createSession(res, {
      email: user.email,
      name: user.name,
      picture: user.picture,
    });

    logger.info({ email: user.email }, "User logged in");
    res.redirect("/");
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/logout - Destroy session
 */
router.post("/logout", (req, res) => {
  destroySession(req, res);
  res.json({ success: true });
});

/**
 * GET /auth/me - Get current user info
 */
router.get("/me", (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.json({ authenticated: false });
    return;
  }
  res.json({
    authenticated: true,
    user: session,
  });
});

export default router;
