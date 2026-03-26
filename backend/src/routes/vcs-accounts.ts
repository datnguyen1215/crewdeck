/** Routes for managing VCS accounts via SSH key + PAT. */
import { Router } from "express";
import * as vcsAccounts from "../db/repositories/vcs-accounts.js";
import { validate } from "../middleware/validate.js";
import {
  CreateVCSAccountSchema,
  UpdateVCSAccountSchema,
} from "../schemas/validation.js";
import { NotFoundError } from "../middleware/errors.js";
import type { VCSAccount } from "../types/entities.js";

const router = Router();

/** Strips secrets from a VCS account before sending to the client. */
const stripSecrets = ({
  token: _t,
  ssh_private_key,
  ...rest
}: VCSAccount) => ({
  ...rest,
  ssh_configured: !!ssh_private_key,
});

router.post("/", validate(CreateVCSAccountSchema), (req, res) => {
  const account = vcsAccounts.createVCSAccount(req.body);
  res.status(201).json(stripSecrets(account));
});

router.get("/", (_req, res) => {
  const accounts = vcsAccounts.listVCSAccounts();
  res.json(accounts.map((a) => stripSecrets(a)));
});

router.patch("/:id", validate(UpdateVCSAccountSchema), (req, res) => {
  const existing = vcsAccounts.getVCSAccount(req.params.id);
  if (!existing) throw new NotFoundError("VCS account not found");
  const updated = vcsAccounts.updateVCSAccount(req.params.id, req.body);
  if (!updated) throw new NotFoundError("VCS account not found");
  res.json(stripSecrets(updated));
});

router.delete("/:id", (req, res) => {
  const account = vcsAccounts.getVCSAccount(req.params.id);
  if (!account) throw new NotFoundError("VCS account not found");
  vcsAccounts.deleteVCSAccount(req.params.id);
  res.status(204).send();
});

export default router;
