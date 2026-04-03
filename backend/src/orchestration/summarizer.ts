import { logger } from "../logger.js";
import { spawnClaude } from "./process.js";
import { getDefaultModel } from "../db/repositories/global-config.js";
import { updateIssue } from "../db/repositories/issues.js";

const SYSTEM_PROMPT =
  "You are a summarizer. Given an issue title and description, output a 1-2 sentence summary that captures the key goal and approach. Output only the summary text, nothing else.";

/**
 * Fire-and-forget: spawn a lightweight Claude call to summarize an issue.
 * On success, stores the summary in the DB. On failure, falls back to the title.
 */
export function summarizeIssueAsync(
  issueId: string,
  title: string,
  description: string,
): void {
  const model = getDefaultModel();
  const userPrompt = `Title: ${title}\n\nDescription:\n${description}`;

  spawnClaude({
    prompt: userPrompt,
    systemPrompt: SYSTEM_PROMPT,
    workdir: process.cwd(),
    model,
  })
    .then(async ({ exitPromise }) => {
      const { code, stdout } = await exitPromise;

      if (code !== 0) {
        logger.warn(
          { issueId, code },
          "Summarizer exited non-zero, falling back to title",
        );
        updateIssue(issueId, { summary: title });
        return;
      }

      // Claude CLI with --output-format json wraps the result
      let text = stdout.trim();
      try {
        const parsed = JSON.parse(text);
        text = parsed.result ?? parsed.text ?? text;
      } catch {
        // If not valid JSON, use raw stdout
      }

      text = text.trim();
      if (!text || text.length < 5) {
        logger.warn(
          { issueId, text: text.slice(0, 100) },
          "Summarizer returned empty/short result, falling back to title",
        );
        updateIssue(issueId, { summary: title });
        return;
      }

      updateIssue(issueId, { summary: text });
      logger.info({ issueId, summaryLen: text.length }, "Issue summarized");
    })
    .catch((err) => {
      logger.error({ issueId, err }, "Summarizer failed, falling back to title");
      updateIssue(issueId, { summary: title });
    });
}
