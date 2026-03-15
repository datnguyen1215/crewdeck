import { Router } from "express";
import {
  listProjects,
  listProjectsWithStats,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from "../db/repositories/projects.js";
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

router.post("/", validate(CreateProjectSchema), (req, res) => {
  const project = createProject(req.body);
  res.status(201).json(project);
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
