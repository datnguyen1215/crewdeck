/** Routes for managing GitHub accounts via SSH key + PAT. */
import { Router } from "express";
import * as ghAccounts from "../db/repositories/github-accounts.js";
import { validate } from "../middleware/validate.js";
import {
  CreateGitHubAccountSchema,
  UpdateGitHubAccountSchema,
} from "../schemas/validation.js";
import { NotFoundError } from "../middleware/errors.js";
import type { GitHubAccount } from "../types/entities.js";

const router = Router();

/** Strips secrets from a GitHub account before sending to the client. */
const stripSecrets = ({
  gh_token: _t,
  ssh_private_key: _k,
  ...rest
}: GitHubAccount) => rest;

router.post("/", validate(CreateGitHubAccountSchema), (req, res) => {
  const account = ghAccounts.createGitHubAccount(req.body);
  res.status(201).json(stripSecrets(account));
});

router.get("/", (_req, res) => {
  const accounts = ghAccounts.listGitHubAccounts();
  res.json(accounts.map((a) => stripSecrets(a)));
});

router.patch("/:id", validate(UpdateGitHubAccountSchema), (req, res) => {
  const existing = ghAccounts.getGitHubAccount(req.params.id);
  if (!existing) throw new NotFoundError("GitHub account not found");
  const updated = ghAccounts.updateGitHubAccount(req.params.id, req.body);
  if (!updated) throw new NotFoundError("GitHub account not found");
  res.json(stripSecrets(updated));
});

router.delete("/:id", (req, res) => {
  const account = ghAccounts.getGitHubAccount(req.params.id);
  if (!account) throw new NotFoundError("GitHub account not found");
  ghAccounts.deleteGitHubAccount(req.params.id);
  res.status(204).send();
});

export default router;
