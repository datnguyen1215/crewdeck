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
import { NotFoundError, ValidationError } from "../middleware/errors.js";

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
 * Returns currently running/queued agent runs with agent info, issue info, and optional recent events
 * Query params:
 *   - include_events=true: Include recent events (default: false)
 */
router.get(
  "/active-runs",
  verifyProject,
  (req: Request<{ projectId: string }>, res) => {
    const includeEvents = req.query.include_events === "true";
    const runs = listActiveRunsForProject(req.params.projectId);
    const result = runs.map((run) => {
      const agent = getCrewMember(run.agent_id);
      const issue = run.issue_id ? getIssue(run.issue_id) : null;
      const recentEvents = includeEvents
        ? listRecentAgentRunEvents(run.id, 50)
        : [];
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
 * Query params:
 *   - events_limit=N: Limit number of events returned (default: 20, use 0 for all events)
 */
router.get(
  "/runs/:runId",
  verifyProject,
  (req: Request<{ projectId: string; runId: string }>, res) => {
    const eventsLimitParam = req.query.events_limit as string | undefined;
    let eventsLimit = 20;
    if (eventsLimitParam !== undefined) {
      const parsed = parseInt(eventsLimitParam, 10);
      if (isNaN(parsed)) {
        throw new ValidationError("events_limit must be a valid number");
      }
      eventsLimit = parsed;
    }

    const run = getAgentRunWithEvents(req.params.runId, eventsLimit);
    if (!run) {
      throw new NotFoundError("Run not found");
    }
    // Verify the run belongs to this project
    if (run.project_id !== req.params.projectId) {
      throw new NotFoundError("Run not found");
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
