/**
 * Provider Environment Variables
 *
 * Shared utility to build environment variables for Claude CLI based on
 * the globally configured provider. Used by both process.ts and pty-service.ts.
 */
import { getProvider } from "../db/repositories/global-config.js";
import * as globalEnvVarRepo from "../db/repositories/global-environment-variables.js";

/**
 * Get ZAI_API_KEY from process.env or global env vars.
 */
export function getZaiApiKey(): string | undefined {
  // Check process.env first, then global env vars
  if (process.env.ZAI_API_KEY) {
    return process.env.ZAI_API_KEY;
  }
  const globalEnvVar = globalEnvVarRepo.getByKey("ZAI_API_KEY");
  return globalEnvVar?.value;
}

/**
 * Build environment variables for Claude CLI based on configured provider.
 * When GLM provider is selected, inject ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN.
 */
export function buildProviderEnv(): Record<string, string> {
  const provider = getProvider();
  const zaiApiKey = getZaiApiKey();
  if (provider === "glm" && zaiApiKey) {
    return {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: zaiApiKey,
    };
  }
  return {};
}
