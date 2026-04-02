import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import * as apiKeys from "../db/repositories/api-keys.js";
import { ForbiddenError, NotFoundError } from "../middleware/errors.js";

const router = Router();

// API keys cannot manage other API keys — require session auth
function requireSessionAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.session?.username?.startsWith("api-key:")) {
    next(
      new ForbiddenError(
        "API key authentication not allowed for key management",
      ),
    );
    return;
  }
  next();
}

router.use(requireSessionAuth);

router.get("/", (_req, res) => {
  res.json(apiKeys.listApiKeys());
});

router.post("/", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "name is required" },
    });
    return;
  }
  const { apiKey, plaintext } = apiKeys.createApiKey(name.trim());
  res.status(201).json({ ...apiKey, key: plaintext });
});

router.delete("/:id", (req, res) => {
  const deleted = apiKeys.deleteApiKey(req.params.id);
  if (!deleted) throw new NotFoundError("API key not found");
  res.status(204).send();
});

export default router;
