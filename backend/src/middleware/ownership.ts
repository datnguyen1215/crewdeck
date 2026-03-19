import type { Request, Response, NextFunction } from "express";
import { getProject } from "../db/repositories/projects.js";
import { getIssue, getIssueWithDetails } from "../db/repositories/issues.js";
import { getRepo } from "../db/repositories/repos.js";
import { getComment } from "../db/repositories/comments.js";
import { NotFoundError } from "./errors.js";

declare global {
  namespace Express {
    interface Request {
      project?: NonNullable<ReturnType<typeof getProject>>;
      issue?: NonNullable<ReturnType<typeof getIssue>>;
      issueWithDetails?: NonNullable<ReturnType<typeof getIssueWithDetails>>;
      repo?: NonNullable<ReturnType<typeof getRepo>>;
      comment?: NonNullable<ReturnType<typeof getComment>>;
    }
  }
}

export function verifyProject(req: Request, _res: Response, next: NextFunction): void {
  const project = getProject(req.params.projectId);
  if (!project) throw new NotFoundError("Project not found");
  req.project = project;
  next();
}

export function verifyIssueOwnership(req: Request, _res: Response, next: NextFunction): void {
  const issue = getIssue(req.params.issueId);
  if (!issue || issue.project_id !== req.params.projectId) {
    throw new NotFoundError("Issue not found");
  }
  req.issue = issue;
  next();
}

export function verifyIssueWithDetails(req: Request, _res: Response, next: NextFunction): void {
  const issue = getIssueWithDetails(req.params.issueId);
  if (!issue || issue.project_id !== req.params.projectId) {
    throw new NotFoundError("Issue not found");
  }
  req.issueWithDetails = issue;
  next();
}

export function verifyRepoOwnership(req: Request, _res: Response, next: NextFunction): void {
  const repo = getRepo(req.params.repoId);
  if (!repo || repo.project_id !== req.params.projectId) {
    throw new NotFoundError("Repo not found");
  }
  req.repo = repo;
  next();
}

export function verifyCommentOwnership(req: Request, _res: Response, next: NextFunction): void {
  const comment = getComment(req.params.commentId);
  if (!comment || comment.issue_id !== req.params.issueId) {
    throw new NotFoundError("Comment not found");
  }
  req.comment = comment;
  next();
}
