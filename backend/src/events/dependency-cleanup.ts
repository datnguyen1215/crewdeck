import { logger } from "../logger.js";
import { eventBus } from "./bus.js";
import { IssueStatus } from "../constants/statuses.js";
import {
  listDependents,
  removeDependency,
} from "../db/repositories/issue-dependencies.js";

export function initDependencyCleanup(): void {
  eventBus.on("issue.status_changed", ({ issue_id, to }) => {
    if (to !== IssueStatus.DONE) return;

    const dependents = listDependents(issue_id);
    for (const dependentId of dependents) {
      removeDependency(dependentId, issue_id);
      logger.info(
        { issueId: dependentId, resolvedDependency: issue_id },
        "Auto-removed resolved dependency",
      );
    }
  });
}
