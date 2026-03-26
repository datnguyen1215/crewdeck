/**
 * Terminal API routes
 *
 * Manages PTY-backed terminal sessions for captain chat.
 */
import { Router } from "express";
import { AppError } from "../middleware/error-handler.js";
import {
  createTerminalSession,
  getTerminalSession,
  destroyTerminalSession,
} from "../orchestration/captain/pty-service.js";
import { getProject } from "../db/repositories/projects.js";

const router = Router({ mergeParams: true });

/**
 * POST /terminal
 * Create a terminal session for the project
 */
router.post("/terminal", async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const project = getProject(projectId);
    if (!project) {
      throw new AppError("NOT_FOUND", "Project not found", 404);
    }

    const session = await createTerminalSession(projectId);
    if (!session) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Failed to create terminal session",
        500,
      );
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
router.get("/terminal", (req, res, next) => {
  try {
    const { projectId } = req.params;

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
router.delete("/terminal", async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const destroyed = await destroyTerminalSession(projectId);
    res.json({ destroyed });
  } catch (err) {
    next(err);
  }
});

export default router;
