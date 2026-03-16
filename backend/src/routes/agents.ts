import { Router, type Request } from "express";
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
import { CreateAgentSchema, UpdateAgentSchema, GenerateAgentSchema } from "../schemas/validation.js";
import { callClaude } from "../utils/claude.js";
import { escapeXml } from "../utils/xml.js";

const router = Router({ mergeParams: true });

router.get("/", (req: Request<{ projectId: string }>, res) => {
  const { projectId } = req.params;
  if (!getProject(projectId)) throw new NotFoundError("Project not found");
  const crew = getCrew(projectId);
  if (!crew) throw new NotFoundError("Crew not found");
  res.json(listAgents(crew.id));
});

router.post("/generate", validate(GenerateAgentSchema), async (req: Request<{ projectId: string }>, res, next) => {
  try {
    const { projectId } = req.params;
    if (!getProject(projectId)) throw new NotFoundError("Project not found");
    if (!getCrew(projectId)) throw new NotFoundError("Crew not found");

    const { prompt } = req.body as { prompt: string };
    const systemPrompt = `You are a helper that generates AI agent configurations. Given a short description, generate a JSON object with these four fields:
- "name": a short first name for the agent (e.g. "Alice", "Rex", "Nova")
- "title": a professional title (e.g. "Senior Frontend Engineer", "DevOps Specialist")
- "description": a 1-2 sentence summary of what this agent does
- "system_prompt": a detailed system prompt (3-8 sentences) that instructs the agent on its role, approach, and guidelines

Respond with ONLY a valid JSON object. No markdown, no explanation.`;

    const fullPrompt = `${systemPrompt}\n\nUser description: ${escapeXml(prompt)}`;
    const output = await callClaude(fullPrompt);

    // Extract JSON from possible markdown code blocks
    const trimmed = output.trim();
    const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/);
    const jsonStr = codeBlock ? codeBlock[1].trim() : trimmed;

    const generated = JSON.parse(jsonStr);
    res.json({
      name: generated.name ?? "",
      title: generated.title ?? "",
      description: generated.description ?? "",
      system_prompt: generated.system_prompt ?? "",
    });
  } catch (err) {
    next(err);
  }
});

router.post("/", validate(CreateAgentSchema), (req: Request<{ projectId: string }>, res) => {
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
