import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "../logger.js";
import { NotFoundError, ValidationError, InvalidTransitionError, ForbiddenError, ConflictError, UnauthorizedError } from "./errors.js";

type AppError = NotFoundError | ValidationError | InvalidTransitionError | ForbiddenError | ConflictError | UnauthorizedError;

function isAppError(err: unknown): err is AppError {
  return (
    err instanceof NotFoundError ||
    err instanceof ValidationError ||
    err instanceof InvalidTransitionError ||
    err instanceof ForbiddenError ||
    err instanceof ConflictError ||
    err instanceof UnauthorizedError
  );
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: err.flatten().fieldErrors,
      },
    });
    return;
  }

  if (isAppError(err)) {
    const body: Record<string, unknown> = {
      code: err.code,
      message: err.message,
    };
    if ("details" in err && err.details !== undefined) body.details = err.details;
    res.status(err.status).json({ error: body });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });
}
