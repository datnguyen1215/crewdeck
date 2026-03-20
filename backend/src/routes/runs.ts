import { Router, type Request } from "express";
import {
  listAgentRunsForIssue,
  listAgentRunsForProject,
  getAgentRunWithEvents,
} from "../db/repositories/agent-runs.js";
import { verifyProject, verifyIssueOwnership } from "../middleware/ownership.js";

const router = Router({ mergeParams: true });

/**
 * GET /projects/:projectId/issues/:issueId/runs
 * List all runs for an issue
 */
router.get(
  "/issues/:issueId/runs",
  verifyIssueOwnership,
  (req: Request<{ projectId: string; issueId: string }>, res) => {
    const runs = listAgentRunsForIssue(req.params.issueId);
    res.json(runs);
  }
);

/**
 * GET /projects/:projectId/runs/:runId
 * Get a single run with its events
 */
router.get(
  "/runs/:runId",
  verifyProject,
  (req: Request<{ projectId: string; runId: string }>, res) => {
    const run = getAgentRunWithEvents(req.params.runId);
    if (!run) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
      return;
    }
    // Verify the run belongs to this project
    if (run.project_id !== req.params.projectId) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
      return;
    }
    res.json(run);
  }
);

/**
 * GET /projects/:projectId/runs
 * List all runs for a project (paginated)
 */
router.get(
  "/runs",
  verifyProject,
  (req: Request<{ projectId: string }>, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const runs = listAgentRunsForProject(req.params.projectId, { limit, offset });
    res.json(runs);
  }
);

export default router;
