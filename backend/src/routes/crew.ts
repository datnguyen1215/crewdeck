import { Router } from "express";
import { getCrew, getCrewWithAgents, updateCrew } from "../db/repositories/crews.js";
import { getProject } from "../db/repositories/projects.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../middleware/errors.js";
import { UpdateCrewSchema } from "../schemas/validation.js";

const router = Router({ mergeParams: true });

router.get("/", (req, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");
  const crew = getCrewWithAgents(projectId);
  if (!crew) throw new NotFoundError("Crew not found");
  res.json(crew);
});

router.patch("/", validate(UpdateCrewSchema), (req, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");
  const existing = getCrew(projectId);
  if (!existing) throw new NotFoundError("Crew not found");
  const crew = updateCrew(projectId, req.body);
  res.json(crew);
});

export default router;
