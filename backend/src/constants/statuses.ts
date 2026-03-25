/** Issue status constants. */
export const IssueStatus = {
  OPEN: "open",
  IN_PROGRESS: "in_progress",
  PR_CREATED: "pr_created",
  PR_CONFLICT: "pr_conflict",
  PR_FAILED_ACTIONS: "pr_failed_actions",
  PR_READY_TO_MERGE: "pr_ready_to_merge",
  DONE: "done",
} as const;

export type IssueStatusValue = (typeof IssueStatus)[keyof typeof IssueStatus];

export const ISSUE_STATUSES = Object.values(IssueStatus);

/** PR status constants. */
export const PRStatus = {
  OPEN: "open",
  MERGED: "merged",
  CLOSED: "closed",
} as const;

export type PRStatusValue = (typeof PRStatus)[keyof typeof PRStatus];

export const PR_STATUSES = Object.values(PRStatus);

/** Issue statuses that represent a PR-related state. */
export const PR_RELATED_ISSUE_STATUSES: ReadonlySet<IssueStatusValue> = new Set(
  [
    IssueStatus.PR_CREATED,
    IssueStatus.PR_CONFLICT,
    IssueStatus.PR_FAILED_ACTIONS,
    IssueStatus.PR_READY_TO_MERGE,
  ],
);

/** Valid issue status transitions. */
export const TRANSITIONS: Partial<
  Record<IssueStatusValue, IssueStatusValue[]>
> = {
  [IssueStatus.OPEN]: [IssueStatus.IN_PROGRESS, IssueStatus.DONE],
  [IssueStatus.IN_PROGRESS]: [IssueStatus.PR_CREATED, IssueStatus.DONE],
  [IssueStatus.PR_CREATED]: [
    IssueStatus.IN_PROGRESS,
    IssueStatus.DONE,
    IssueStatus.PR_CONFLICT,
    IssueStatus.PR_FAILED_ACTIONS,
    IssueStatus.PR_READY_TO_MERGE,
  ],
  [IssueStatus.PR_CONFLICT]: [IssueStatus.PR_CREATED, IssueStatus.IN_PROGRESS],
  [IssueStatus.PR_FAILED_ACTIONS]: [
    IssueStatus.PR_CREATED,
    IssueStatus.IN_PROGRESS,
  ],
  [IssueStatus.PR_READY_TO_MERGE]: [
    IssueStatus.DONE,
    IssueStatus.PR_CONFLICT,
    IssueStatus.IN_PROGRESS,
  ],
};
