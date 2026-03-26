import { Router, type Request } from "express";
import {
  listAgentRunsForIssue,
  listAgentRunsForProject,
  getAgentRunWithEvents,
  listActiveRunsForProject,
  listRecentAgentRunEvents,
} from "../db/repositories/agent-runs.js";
import { getCrewMember } from "../orchestration/crew.js";
import { getIssue } from "../db/repositories/issues.js";
import {
  verifyProject,
  verifyIssueOwnership,
} from "../middleware/ownership.js";

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
  },
);

/**
 * GET /projects/:projectId/active-runs
 * Returns currently running/queued agent runs with agent info, issue info, and recent events
 */
router.get(
  "/active-runs",
  verifyProject,
  (req: Request<{ projectId: string }>, res) => {
    const runs = listActiveRunsForProject(req.params.projectId);
    const result = runs.map((run) => {
      const agent = getCrewMember(run.agent_id);
      const issue = run.issue_id ? getIssue(run.issue_id) : null;
      const recentEvents = listRecentAgentRunEvents(run.id, 50);
      return {
        ...run,
        agent_name: agent?.name ?? run.agent_id,
        agent_title: agent?.title ?? null,
        issue_title: issue?.title ?? null,
        events: recentEvents,
      };
    });
    res.json(result);
  },
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
      res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Run not found" } });
      return;
    }
    // Verify the run belongs to this project
    if (run.project_id !== req.params.projectId) {
      res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Run not found" } });
      return;
    }
    res.json(run);
  },
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
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const runs = listAgentRunsForProject(req.params.projectId, {
      limit,
      offset,
    });
    res.json(runs);
  },
);

export default router;
