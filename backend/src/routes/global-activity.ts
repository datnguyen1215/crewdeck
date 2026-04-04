import { Router, type Request } from "express";
import {
  listGlobalActivity,
  enrichActivityEntries,
} from "../db/repositories/activity-log.js";
import { ValidationError } from "../middleware/errors.js";
import type { ActivityFilters } from "../types/entities.js";

const router = Router();

router.get("/", (req: Request, res) => {
  const { since, limit, offset } = req.query as Record<string, string>;
  const filters: ActivityFilters = {};
  if (since) {
    const d = new Date(since);
    if (isNaN(d.getTime())) {
      throw new ValidationError("since must be a valid date");
    }
    filters.since = d.toISOString().slice(0, 19).replace("T", " ");
  }
  if (limit) {
    const parsed = parseInt(limit, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError("limit must be a non-negative integer");
    }
    filters.limit = Math.min(parsed, 50);
  }
  if (offset) {
    const parsed = parseInt(offset, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new ValidationError("offset must be a non-negative integer");
    }
    filters.offset = parsed;
  }

  const entries = listGlobalActivity(filters);
  res.json(enrichActivityEntries(entries, true, { projectNames: true }));
});

export default router;
