import type { Request, Response, NextFunction } from "express";
import { getProject } from "../db/repositories/projects.js";
import { getIssue, getIssueWithDetails } from "../db/repositories/issues.js";
import { getRepo } from "../db/repositories/repos.js";
import { getSession } from "../db/repositories/sessions.js";
import { getComment } from "../db/repositories/comments.js";
import { NotFoundError } from "./errors.js";

// Extend Express Request to carry verified resources
declare global {
  namespace Express {
    interface Request {
      project?: ReturnType<typeof getProject>;
      issue?: NonNullable<ReturnType<typeof getIssue>>;
      issueWithDetails?: NonNullable<ReturnType<typeof getIssueWithDetails>>;
      repo?: NonNullable<ReturnType<typeof getRepo>>;
      session?: NonNullable<ReturnType<typeof getSession>>;
      comment?: NonNullable<ReturnType<typeof getComment>>;
    }
  }
}

/** Verify project exists and attach to req.project */
export function verifyProject(req: Request, _res: Response, next: NextFunction): void {
  const project = getProject(req.params.projectId);
  if (!project) throw new NotFoundError("Project not found");
  req.project = project;
  next();
}

/** Verify issue exists and belongs to the project. Attach to req.issue */
export function verifyIssueOwnership(req: Request, _res: Response, next: NextFunction): void {
  const issue = getIssue(req.params.issueId);
  if (!issue || issue.project_id !== req.params.projectId) {
    throw new NotFoundError("Issue not found");
  }
  req.issue = issue;
  next();
}

/** Same as verifyIssueOwnership but fetches the full details view */
export function verifyIssueWithDetails(req: Request, _res: Response, next: NextFunction): void {
  const issue = getIssueWithDetails(req.params.issueId);
  if (!issue || issue.project_id !== req.params.projectId) {
    throw new NotFoundError("Issue not found");
  }
  req.issueWithDetails = issue;
  next();
}

/** Verify repo exists and belongs to the project. Attach to req.repo */
export function verifyRepoOwnership(req: Request, _res: Response, next: NextFunction): void {
  const repo = getRepo(req.params.repoId);
  if (!repo || repo.project_id !== req.params.projectId) {
    throw new NotFoundError("Repo not found");
  }
  req.repo = repo;
  next();
}

/** Verify session exists and belongs to the project. Attach to req.session */
export function verifySessionOwnership(req: Request, _res: Response, next: NextFunction): void {
  const session = getSession(req.params.sessionId);
  if (!session || session.project_id !== req.params.projectId) {
    throw new NotFoundError("Session not found");
  }
  req.session = session;
  next();
}

/** Verify comment exists and belongs to the issue. Attach to req.comment. Requires req.issue to be set first. */
export function verifyCommentOwnership(req: Request, _res: Response, next: NextFunction): void {
  const comment = getComment(req.params.commentId);
  if (!comment || comment.issue_id !== req.params.issueId) {
    throw new NotFoundError("Comment not found");
  }
  req.comment = comment;
  next();
}
