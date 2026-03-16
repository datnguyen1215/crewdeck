import { Router, type Request } from "express";
import { listCaptainMessages, createCaptainMessage } from "../db/repositories/captain-messages.js";
import { getProject } from "../db/repositories/projects.js";
import { validate } from "../middleware/validate.js";
import { NotFoundError } from "../middleware/errors.js";
import { CreateCaptainMessageSchema } from "../schemas/validation.js";
import { eventBus } from "../events/bus.js";

const router = Router({ mergeParams: true });

router.get("/messages", (req: Request<{ projectId: string }>, res) => {
  const project = getProject(req.params.projectId);
  if (!project) throw new NotFoundError("Project not found");
  res.json(listCaptainMessages(req.params.projectId));
});

router.post("/messages", validate(CreateCaptainMessageSchema), (req: Request<{ projectId: string }>, res) => {
  const project = getProject(req.params.projectId);
  if (!project) throw new NotFoundError("Project not found");

  const message = createCaptainMessage(req.params.projectId, {
    ...req.body,
    author_type: "user",
  });

  eventBus.emit("captain.message", { message, project_id: project.id });
  res.status(201).json(message);
});

export default router;
