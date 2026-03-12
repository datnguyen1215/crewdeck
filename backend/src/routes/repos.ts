import { Router } from "express";
import { listRepos, getRepo, createRepo, deleteRepo } from "../db/repositories/repos.js";
import { getProject } from "../db/repositories/projects.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../middleware/errors.js";
import { CreateRepoSchema } from "../schemas/validation.js";

const router = Router({ mergeParams: true });

router.get("/", (req, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");
  res.json(listRepos(projectId));
});

router.post("/", validate(CreateRepoSchema), (req, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");
  const repo = createRepo(projectId, req.body);
  res.status(201).json(repo);
});

router.delete("/:repoId", (req, res) => {
  const repo = getRepo(req.params.repoId);
  if (!repo || repo.project_id !== req.params.projectId) throw new NotFoundError("Repo not found");
  deleteRepo(req.params.repoId);
  res.status(204).send();
});

export default router;
