import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { ValidationError } from "./errors.js";

export function validate(schema: ZodSchema, source: "body" | "query" = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const data = source === "query" ? req.query : req.body;
    const result = schema.safeParse(data);
    if (!result.success) {
      next(new ValidationError("Validation failed", result.error.flatten().fieldErrors));
      return;
    }
    if (source === "query") {
      req.query = result.data;
    } else {
      req.body = result.data;
    }
    next();
  };
}
