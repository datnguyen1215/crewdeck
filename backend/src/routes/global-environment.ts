import { Router } from "express";
import * as globalEnvRepo from "../db/repositories/global-environment-variables.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError, ConflictError } from "../middleware/errors.js";
import {
  CreateGlobalEnvironmentVariableSchema,
  UpdateGlobalEnvironmentVariableSchema,
} from "../schemas/validation.js";
import type { GlobalEnvironmentVariable } from "../types/entities.js";

const router = Router();

/** Mask secret values in the response */
function maskSecrets(
  envVar: GlobalEnvironmentVariable,
): GlobalEnvironmentVariable {
  if (envVar.is_secret) {
    return { ...envVar, value: "••••••••" };
  }
  return envVar;
}

function rethrowUniqueConflict(err: unknown): never {
  if (
    err instanceof Error &&
    err.message.includes("UNIQUE constraint failed")
  ) {
    throw new ConflictError(
      "Global environment variable with this key already exists",
    );
  }
  throw err;
}

router.get("/", (_req, res) => {
  const vars = globalEnvRepo.list();
  res.json(vars.map(maskSecrets));
});

router.post(
  "/",
  validate(CreateGlobalEnvironmentVariableSchema),
  (req, res) => {
    try {
      const envVar = globalEnvRepo.create(req.body);
      res.status(201).json(maskSecrets(envVar));
    } catch (err) {
      rethrowUniqueConflict(err);
    }
  },
);

router.patch(
  "/:envVarId",
  validate(UpdateGlobalEnvironmentVariableSchema),
  (req, res) => {
    const existing = globalEnvRepo.get(req.params.envVarId);
    if (!existing) {
      throw new NotFoundError("Global environment variable not found");
    }
    try {
      const updated = globalEnvRepo.update(existing.id, req.body);
      res.json(maskSecrets(updated));
    } catch (err) {
      rethrowUniqueConflict(err);
    }
  },
);

router.delete("/:envVarId", (req, res) => {
  const existing = globalEnvRepo.get(req.params.envVarId);
  if (!existing) {
    throw new NotFoundError("Global environment variable not found");
  }
  globalEnvRepo.remove(existing.id);
  res.status(204).send();
});

export default router;
