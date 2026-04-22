import { logger } from "../logger.js";
import { spawnClaude } from "./process.js";
import { getDefaultModel } from "../db/repositories/global-config.js";
import { updateIssue } from "../db/repositories/issues.js";

const MAX_SUMMARY_CHARS = 300;

const SYSTEM_PROMPT =
  "Summarize issue. One short sentence. Caveman tone — fragments, blunt, no filler.\n" +
  "Output ONLY <summary>...</summary> tags. No code. No quotes of description. No preamble.\n" +
  "Max 200 characters inside tags. If cannot summarize, output <summary></summary>.\n" +
  "Example: <summary>Retry webhook dispatcher on transient fail.</summary>";

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
        if (Array.isArray(parsed)) {
          const assistant = parsed.find((e: any) => e.type === 'assistant');
          const textBlock = assistant?.message?.content?.find((b: any) => b.type === 'text');
          text = textBlock?.text ?? text;
        } else {
          text = parsed.result ?? parsed.text ?? text;
        }
      } catch {
        // If not valid JSON, use raw stdout
      }

      const summaryMatch = text.match(/<summary>(.*?)<\/summary>/s);
      if (!summaryMatch) {
        logger.warn(
          { issueId, textPreview: text.slice(0, 100) },
          "Summarizer: no <summary> tag, falling back to title",
        );
        updateIssue(issueId, { summary: title });
        return;
      }

      text = summaryMatch[1].trim();
      if (text.length < 5) {
        logger.warn({ issueId, len: text.length }, "Summarizer: empty/short, falling back to title");
        updateIssue(issueId, { summary: title });
        return;
      }

      if (text.length > MAX_SUMMARY_CHARS) text = text.slice(0, MAX_SUMMARY_CHARS);

      updateIssue(issueId, { summary: text });
      logger.info({ issueId, summaryLen: text.length }, "Issue summarized");
    })
    .catch((err) => {
      logger.error({ issueId, err }, "Summarizer failed, falling back to title");
      updateIssue(issueId, { summary: title });
    });
}
