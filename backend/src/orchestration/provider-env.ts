/**
 * Provider Environment Variables
 *
 * Shared utility to build environment variables for Claude CLI based on
 * the globally configured provider. Used by both process.ts and pty-service.ts.
 */
import { getProvider } from "../db/repositories/global-config.js";

/**
 * Build environment variables for Claude CLI based on configured provider.
 * When GLM provider is selected, inject ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN.
 */
export function buildProviderEnv(): Record<string, string> {
  const provider = getProvider();
  if (provider === "glm" && process.env.ZAI_API_KEY) {
    return {
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: process.env.ZAI_API_KEY,
    };
  }
  return {};
}
