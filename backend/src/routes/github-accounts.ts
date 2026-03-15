/** Routes for managing GitHub accounts via Device Flow OAuth. */
import { Router } from "express";
import * as ghAccounts from "../db/repositories/github-accounts.js";
import * as deviceFlow from "../github/device-flow.js";
import { config } from "../config.js";
import { validate } from "../middleware/validate.js";
import {
  InitDeviceFlowSchema,
  PollDeviceFlowSchema,
} from "../schemas/validation.js";
import { NotFoundError, ValidationError } from "../middleware/errors.js";
import type { GitHubAccount } from "../types/entities.js";

const router = Router();

/** Strips oauth_token from a GitHub account before sending to the client. */
const stripToken = ({ oauth_token: _, ...rest }: GitHubAccount) => rest;

router.post("/device-code", validate(InitDeviceFlowSchema), async (req, res, next) => {
  try {
    const clientId = req.body.client_id || config.githubClientId;
    if (!clientId) throw new ValidationError("No GitHub client_id provided and GITHUB_CLIENT_ID is not configured");

    const result = await deviceFlow.requestDeviceCode(clientId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/device-code/poll", validate(PollDeviceFlowSchema), async (req, res, next) => {
  try {
    const clientId = req.body.client_id || config.githubClientId;
    if (!clientId) throw new ValidationError("No GitHub client_id provided and GITHUB_CLIENT_ID is not configured");

    const result = await deviceFlow.pollForToken(clientId, req.body.device_code);

    if ("access_token" in result) {
      // NOTE: if getGitHubUsername fails (network blip, rate limit), the token is lost and
      // the user must re-authorize. This is intentional — saving with a placeholder username
      // adds complexity for a very unlikely edge case. The orphaned token on GitHub's side is
      // harmless (local tool, no external exposure) and can be manually revoked via GitHub's
      // OAuth app settings if needed. The device code may still be valid for retry, but the
      // frontend clears it on error, so the user starts fresh.
      const username = await deviceFlow.getGitHubUsername(result.access_token);
      const account = ghAccounts.createGitHubAccount({
        account_name: username,
        github_username: username,
        oauth_token: result.access_token,
        scopes: result.scope,
      });
      res.status(201).json(stripToken(account));
      return;
    }

    res.json({ status: "pending", error: result.error, error_description: result.error_description });
  } catch (err) {
    next(err);
  }
});

router.get("/", (_req, res) => {
  const accounts = ghAccounts.listGitHubAccounts();
  res.json(accounts.map((a) => stripToken(a)));
});

router.delete("/:id", async (req, res, next) => {
  try {
    const account = ghAccounts.getGitHubAccount(req.params.id);
    if (!account) throw new NotFoundError("GitHub account not found");

    // Best-effort token revocation — don't fail the delete if it errors
    if (account.oauth_token && config.githubClientId && config.githubClientSecret) {
      try {
        await deviceFlow.revokeToken(config.githubClientId, config.githubClientSecret, account.oauth_token);
      } catch {
        // Ignore revocation errors
      }
    }

    ghAccounts.deleteGitHubAccount(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
