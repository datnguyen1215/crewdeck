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

type EntityWithOwner<K extends string> = { [key in K]: string } | null;

/**
 * Creates a verification function that checks if an entity exists and belongs to an owner.
 * @param getter Function to fetch the entity by ID
 * @param entityName Name for error messages (e.g., "Issue", "Repo")
 * @param ownerKey The property on the entity that links to the owner (e.g., "project_id")
 */
export function createOwnershipVerifier<T extends EntityWithOwner<K>, K extends string>(
  getter: (id: string) => T,
  entityName: string,
  ownerKey: K
): (entityId: string, ownerId: string) => NonNullable<T> {
  return (entityId: string, ownerId: string): NonNullable<T> => {
    const entity = getter(entityId);
    if (!entity || entity[ownerKey] !== ownerId) {
      throw new NotFoundError(`${entityName} not found`);
    }
    return entity as NonNullable<T>;
  };
}

// Pre-built verifiers for common entities
export const verifyIssueOwner = createOwnershipVerifier(getIssue, "Issue", "project_id");
export const verifyRepoOwner = createOwnershipVerifier(getRepo, "Repo", "project_id");
export const verifyCommentOwner = createOwnershipVerifier(getComment, "Comment", "issue_id");

// Middleware versions
export function verifyProject(req: Request, _res: Response, next: NextFunction): void {
  const project = getProject(req.params.projectId);
  if (!project) throw new NotFoundError("Project not found");
  req.project = project;
  next();
}

export function verifyIssueOwnership(req: Request, _res: Response, next: NextFunction): void {
  req.issue = verifyIssueOwner(req.params.issueId, req.params.projectId);
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
  req.repo = verifyRepoOwner(req.params.repoId, req.params.projectId);
  next();
}

export function verifyCommentOwnership(req: Request, _res: Response, next: NextFunction): void {
  req.comment = verifyCommentOwner(req.params.commentId, req.params.issueId);
  next();
}
