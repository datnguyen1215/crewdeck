import { Router } from "express";
import {
  listProjects,
  listProjectsWithStats,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from "../db/repositories/projects.js";
import { getGitHubAccount } from "../db/repositories/github-accounts.js";
import { parseGithubUrl } from "../db/repositories/repos.js";
import { fetchRepoMetadata } from "../github/repo-metadata.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../middleware/errors.js";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
} from "../schemas/validation.js";

const router = Router();

router.get("/", (req, res) => {
  if (req.query.stats !== undefined) {
    res.json(listProjectsWithStats());
  } else {
    res.json(listProjects());
  }
});

router.get("/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) throw new NotFoundError("Project not found");
  res.json(project);
});

router.post("/", validate(CreateProjectSchema), async (req, res, next) => {
  try {
    const body = req.body;
    const { owner, name: repoName } = parseGithubUrl(body.github_url);

    // Fetch metadata from GitHub API
    const token = body.github_account_id
      ? getGitHubAccount(body.github_account_id)?.oauth_token
      : undefined;

    let metadata;
    try {
      metadata = await fetchRepoMetadata(owner, repoName, token);
    } catch (err) {
      // If a GitHub account was explicitly selected, surface the error —
      // the user likely expects private repo access and should know it failed.
      if (body.github_account_id) throw err;
      // For unauthenticated requests, fall back to URL-derived values
      // (e.g. rate-limited on a public repo).
      metadata = { name: repoName, description: null, default_branch: "main" };
    }

    const project = createProject({
      name: body.name || metadata.name,
      description: body.description || metadata.description || undefined,
      github_url: body.github_url,
      default_branch: metadata.default_branch,
      github_account_id: body.github_account_id,
    });

    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", validate(UpdateProjectSchema), (req, res) => {
  const existing = getProject(req.params.id);
  if (!existing) throw new NotFoundError("Project not found");
  res.json(updateProject(req.params.id, req.body));
});

router.delete("/:id", (req, res) => {
  const existing = getProject(req.params.id);
  if (!existing) throw new NotFoundError("Project not found");
  deleteProject(req.params.id);
  res.status(204).send();
});

export default router;
