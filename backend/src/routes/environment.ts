import { Router, type Request } from "express";
import {
  listEnvironmentVariables,
  getEnvironmentVariable,
  createEnvironmentVariable,
  updateEnvironmentVariable,
  deleteEnvironmentVariable,
} from "../db/repositories/environment-variables.js";
import { validate } from "../middleware/validate.js";
import { verifyProject } from "../middleware/ownership.js";
import { NotFoundError, ConflictError } from "../middleware/errors.js";
import {
  CreateEnvironmentVariableSchema,
  UpdateEnvironmentVariableSchema,
} from "../schemas/validation.js";
import type { EnvironmentVariable } from "../types/entities.js";

const router = Router({ mergeParams: true });

/** Mask secret values in the response */
function maskSecrets(envVar: EnvironmentVariable): EnvironmentVariable {
  if (envVar.is_secret) {
    return { ...envVar, value: "••••••••" };
  }
  return envVar;
}

router.get("/", verifyProject, (req: Request<{ projectId: string }>, res) => {
  const vars = listEnvironmentVariables(req.params.projectId);
  res.json(vars.map(maskSecrets));
});

router.post(
  "/",
  verifyProject,
  validate(CreateEnvironmentVariableSchema),
  (req: Request<{ projectId: string }>, res) => {
    try {
      const envVar = createEnvironmentVariable(req.params.projectId, req.body);
      res.status(201).json(maskSecrets(envVar));
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        throw new ConflictError(
          "Environment variable with this key already exists",
        );
      }
      throw err;
    }
  },
);

router.patch(
  "/:envVarId",
  verifyProject,
  validate(UpdateEnvironmentVariableSchema),
  (req: Request<{ projectId: string; envVarId: string }>, res) => {
    const existing = getEnvironmentVariable(req.params.envVarId);
    if (!existing || existing.project_id !== req.params.projectId) {
      throw new NotFoundError("Environment variable not found");
    }
    try {
      const updated = updateEnvironmentVariable(existing.id, req.body);
      res.json(maskSecrets(updated));
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        throw new ConflictError(
          "Environment variable with this key already exists",
        );
      }
      throw err;
    }
  },
);

router.delete(
  "/:envVarId",
  verifyProject,
  (req: Request<{ projectId: string; envVarId: string }>, res) => {
    const existing = getEnvironmentVariable(req.params.envVarId);
    if (!existing || existing.project_id !== req.params.projectId) {
      throw new NotFoundError("Environment variable not found");
    }
    deleteEnvironmentVariable(existing.id);
    res.status(204).send();
  },
);

export default router;
