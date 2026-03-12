import { Router } from "express";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  hasActiveIssues,
} from "../db/repositories/agents.js";
import { getCrew } from "../db/repositories/crews.js";
import { getProject } from "../db/repositories/projects.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError, ConflictError } from "../middleware/errors.js";
import { CreateAgentSchema, UpdateAgentSchema } from "../schemas/validation.js";

const router = Router({ mergeParams: true });

router.get("/", (req, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");
  const crew = getCrew(projectId);
  if (!crew) throw new NotFoundError("Crew not found");
  res.json(listAgents(crew.id));
});

router.post("/", validate(CreateAgentSchema), (req, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");
  const crew = getCrew(projectId);
  if (!crew) throw new NotFoundError("Crew not found");
  const agent = createAgent(crew.id, req.body);
  res.status(201).json(agent);
});

router.patch("/:agentId", validate(UpdateAgentSchema), (req, res) => {
  const agent = getAgent(req.params.agentId);
  if (!agent) throw new NotFoundError("Agent not found");
  res.json(updateAgent(req.params.agentId, req.body));
});

router.delete("/:agentId", (req, res) => {
  const agent = getAgent(req.params.agentId);
  if (!agent) throw new NotFoundError("Agent not found");
  if (hasActiveIssues(req.params.agentId)) {
    throw new ConflictError("Agent has active issues and cannot be deleted");
  }
  deleteAgent(req.params.agentId);
  res.status(204).send();
});

export default router;
