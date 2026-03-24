export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 400;
  readonly details: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export class InvalidTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  readonly status = 400;
  readonly details: unknown;
  constructor(from: string, to: string) {
    super(`Invalid status transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
    this.details = { from, to };
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends Error {
  readonly code = "CONFLICT";
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
