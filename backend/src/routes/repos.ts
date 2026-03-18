import { Router, type Request } from "express";
import { listRepos, createRepo, deleteRepo } from "../db/repositories/repos.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { validate } from "../middleware/validate.js";
import { verifyProject, verifyRepoOwnership } from "../middleware/ownership.js";
import { CreateRepoSchema } from "../schemas/validation.js";

const router = Router({ mergeParams: true });

router.get("/", verifyProject, (req: Request<{ projectId: string }>, res) => {
  res.json(listRepos(req.params.projectId));
});

router.post("/", verifyProject, validate(CreateRepoSchema), (req: Request<{ projectId: string }>, res) => {
  const project = req.project!;
  const ghAccount = project.github_account_id
    ? getGitHubAccount(project.github_account_id)
    : null;
  const repo = createRepo(req.params.projectId, req.body, ghAccount?.oauth_token);
  res.status(201).json(repo);
});

router.delete("/:repoId", verifyRepoOwnership, (req, res) => {
  deleteRepo(req.repo!.id);
  res.status(204).send();
});

export default router;
