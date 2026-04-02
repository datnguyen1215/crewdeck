/**
 * Monitor History API Routes
 *
 * Provides read-only access to monitor messages.
 */
import { Router, type Request } from "express";
import { verifyProject } from "../middleware/ownership.js";
import { getByProject as getMonitorMessages } from "../db/repositories/monitor-messages.js";

const router = Router({ mergeParams: true });

type ProjectParams = { projectId: string };

// GET /monitor/history — get monitor messages
router.get(
  "/monitor/history",
  verifyProject,
  (req: Request<ProjectParams>, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const messages = getMonitorMessages(req.params.projectId, limit);
    // Reverse to return oldest first (chronological order)
    res.json(messages.reverse());
  },
);

export default router;
