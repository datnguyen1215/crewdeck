/**
 * Terminal API routes
 *
 * Manages PTY-backed terminal sessions for captain chat.
 */
import { Router } from "express";
import {
  createTerminalSession,
  getTerminalSession,
  destroyTerminalSession,
} from "../orchestration/pty-service.js";
import { getProject } from "../db/repositories/projects.js";
import { requireScope } from "../middleware/scope.js";
import { NotFoundError } from "../middleware/errors.js";
import { Scope } from "../constants/scopes.js";

const router = Router({ mergeParams: true });

/**
 * POST /terminal
 * Create a terminal session for the project
 */
router.post("/terminal", requireScope(Scope.TERMINAL_WRITE), async (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string };

    const project = getProject(projectId);
    if (!project) {
      throw new NotFoundError("Project not found");
    }

    const session = await createTerminalSession(projectId);
    if (!session) {
      throw new Error("Failed to create terminal session");
    }

    res.json({
      projectId: session.projectId,
      tmuxSessionName: session.tmuxSessionName,
      createdAt: session.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /terminal
 * Get terminal session status
 */
router.get("/terminal", requireScope(Scope.TERMINAL_READ), (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string };

    const session = getTerminalSession(projectId);
    if (!session) {
      res.json({ exists: false });
      return;
    }

    res.json({
      exists: true,
      projectId: session.projectId,
      tmuxSessionName: session.tmuxSessionName,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /terminal
 * Destroy a terminal session
 */
router.delete("/terminal", requireScope(Scope.TERMINAL_DELETE), async (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string };

    const destroyed = await destroyTerminalSession(projectId);
    res.json({ destroyed });
  } catch (err) {
    next(err);
  }
});

export default router;
