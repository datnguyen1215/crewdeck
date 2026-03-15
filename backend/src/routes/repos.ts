import { Router, type Request } from "express";
import { listRepos, getRepo, createRepo, deleteRepo } from "../db/repositories/repos.js";
import { getProject } from "../db/repositories/projects.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../middleware/errors.js";
import { CreateRepoSchema } from "../schemas/validation.js";

const router = Router({ mergeParams: true });

router.get("/", (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");
  res.json(listRepos(projectId));
});

router.post("/", validate(CreateRepoSchema), (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  const project = getProject(projectId);
  if (!project) throw new NotFoundError("Project not found");
  const ghAccount = project.github_account_id
    ? getGitHubAccount(project.github_account_id)
    : null;
  const repo = createRepo(projectId, req.body, ghAccount?.oauth_token);
  res.status(201).json(repo);
});

router.delete("/:repoId", (req: Request<{ projectId: string; repoId: string }>, res) => {
  const repo = getRepo(req.params.repoId);
  if (!repo || repo.project_id !== req.params.projectId) throw new NotFoundError("Repo not found");
  deleteRepo(req.params.repoId);
  res.status(204).send();
});

export default router;
