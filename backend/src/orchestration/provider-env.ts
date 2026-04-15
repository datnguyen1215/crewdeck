/**
 * Provider Environment Variables
 *
 * Shared utility to build environment variables for Claude CLI based on
 * the model name. GLM models use Z.AI; Qwen models use a local LiteLLM proxy;
 * everything else uses Claude/Anthropic.
 */
import * as globalEnvVarRepo from "../db/repositories/global-environment-variables.js";

/**
 * Get ZAI_API_KEY from process.env or global env vars.
 */
export function getZaiApiKey(): string | undefined {
  if (process.env.ZAI_API_KEY) {
    return process.env.ZAI_API_KEY;
  }
  const globalEnvVar = globalEnvVarRepo.getByKey("ZAI_API_KEY");
  return globalEnvVar?.value;
}

/**
 * Get OLLAMA_PROXY_URL from process.env or global env vars.
 * Defaults to http://localhost:4000 (LiteLLM default port).
 */
export function getOllamaProxyUrl(): string {
  if (process.env.OLLAMA_PROXY_URL) {
    return process.env.OLLAMA_PROXY_URL;
  }
  const globalEnvVar = globalEnvVarRepo.getByKey("OLLAMA_PROXY_URL");
  return globalEnvVar?.value ?? "http://localhost:4000";
}

/**
 * Build environment variables for Claude CLI based on model name.
 * If model starts with "glm-", inject Z.AI base URL and auth token.
 * If model starts with "qwen-", inject local LiteLLM proxy URL and auth token.
 * Otherwise return empty object (Claude is the default).
 */
export function buildProviderEnv(model?: string): Record<string, string> {
  if (model?.startsWith("glm-")) {
    const zaiApiKey = getZaiApiKey();
    if (zaiApiKey) {
      return {
        ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: zaiApiKey,
      };
    }
  }
  if (model?.startsWith("qwen-")) {
    return {
      ANTHROPIC_BASE_URL: getOllamaProxyUrl(),
      ANTHROPIC_AUTH_TOKEN: "ollama",
    };
  }
  return {};
}
