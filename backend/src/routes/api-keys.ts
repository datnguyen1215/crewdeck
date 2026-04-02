import { Router } from "express";
import * as apiKeys from "../db/repositories/api-keys.js";
import { NotFoundError } from "../middleware/errors.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(apiKeys.listApiKeys());
});

router.post("/", (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res
      .status(400)
      .json({
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
