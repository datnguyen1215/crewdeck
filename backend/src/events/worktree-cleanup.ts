import { existsSync } from "node:fs";
import { logger } from "../logger.js";
import { eventBus } from "./bus.js";
import { getIssue, updateIssue } from "../db/repositories/issues.js";
import { getRepo } from "../db/repositories/repos.js";
import { cleanupWorktree } from "../agent/worktree.js";

export function initWorktreeCleanup(): void {
  eventBus.on("issue.status_changed", ({ issue_id, to }) => {
    if (to !== "done") return;

    const issue = getIssue(issue_id);
    if (!issue) return;

    const { worktree_path, branch_name, repo_id } = issue;
    if (!worktree_path || !branch_name || !repo_id) return;

    const repo = getRepo(repo_id);
    if (!repo) return;

    // Only cleanup if the path exists on disk
    if (!existsSync(worktree_path)) {
      logger.debug({ issue_id, worktree_path }, "Worktree already gone, clearing fields");
      updateIssue(issue_id, {
        worktree_path: null,
        branch_name: null,
      });
      return;
    }

    cleanupWorktree(repo, worktree_path, branch_name, true)
      .then(() => {
        logger.info({ issue_id, worktree_path, branch_name }, "Worktree cleaned up");
        updateIssue(issue_id, {
          worktree_path: null,
          branch_name: null,
        });
      })
      .catch((err) => {
        logger.warn({ err, issue_id, worktree_path }, "Failed to cleanup worktree, continuing");
      });
  });
}
