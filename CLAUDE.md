# Claude Code Instructions

## Role

Act as a senior software engineer. Write code that is concise, correct, and production-ready.

## Code Principles

- Simplicity first. Prefer the simplest solution that works.
- Keep code short. Don't over-abstract or over-engineer.
- Comments explain **why**, not **what** — unless the logic is genuinely non-obvious.
- No unnecessary wrappers, helpers, or indirection for one-time operations.
- Use standard library and built-in features before reaching for custom code.
- Don't add features, configuration, or error handling beyond what was asked.

## Git Commits

- Do NOT add `Co-Authored-By` trailers to commit messages.
- Commit messages should look like a human wrote them — no AI attribution or signatures.

## Pull Requests

- Always create a pull request for your changes — never push directly to the base branch.
- Include a clear description of what was changed and why.
- Do NOT add AI attribution or signatures (e.g. "Generated with Claude Code") to PR descriptions.

## Code Reviews

- Follow the workflow in `workflows/pr-review.md` for all PR reviews.
- Only review the files and lines changed in the PR diff. Do not explore or review unrelated code.
- Read the diff first, then only look at surrounding context in changed files if needed to understand impact.
