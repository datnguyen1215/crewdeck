# Pull Request Review Workflow

Step-by-step process for reviewing a PR's comments and diffs, deciding what to fix vs. document, and posting actionable instructions for @claude (or a human) to resolve.

## Step 1: Fetch PR Context

Gather all information in parallel:

```bash
# Run all four in parallel
gh pr view <number> --json title,body,state,headRefName,baseRefName,commits,files
gh api repos/<owner>/<repo>/issues/<number>/comments    # issue-level comments
gh api repos/<owner>/<repo>/pulls/<number>/comments     # inline review comments
gh pr diff <number>                                     # current diff
```

Key details to note:
- PR title, description, base/head branches
- Number of commits and files changed
- Whether previous fix rounds have already been applied

## Step 2: Read All Review Comments

Parse comments chronologically. For each comment, identify:
- **Who** posted it (bot review, human instruction, bot fix confirmation)
- **What type** it is (simplicity, correctness, security, human instruction)
- **What issues** it raises (list each numbered finding)

Build a running ledger of every issue raised across all comments.

## Step 3: Read the Current Diff

Read the full diff to understand the **current state** of the code — not the state when reviews were posted. Many issues may already be fixed in later commits.

If the diff is large, focus on the files mentioned in review comments first.

## Step 4: Cross-Reference — Mark Fixed vs. Outstanding

For each issue in the ledger from Step 2:
- **Check the current diff** — is the issue still present in the code?
- **Check fix confirmation comments** — did a bot report fixing it?
- Mark each issue as: `fixed`, `outstanding`, or `not-a-bug` (reviewer misread the code)

Be careful with later review rounds that re-flag issues from earlier rounds. The later reviewer may be reading stale code. If the current diff shows the fix is applied, ignore the re-flag.

## Step 5: Triage Outstanding Issues

Categorize each outstanding issue into one of two buckets:

### Fix — issues that need code changes

An issue should be fixed if it meets ANY of these:
- **Correctness bug** — wrong behavior, race condition, data corruption
- **Security vulnerability** — injection, unsafe defaults, missing validation
- **Silent failure** — errors swallowed without logging, broken error paths
- **Inconsistency** — same pattern handled differently in two places (e.g. `"error"` vs `"completed"` for the same scenario)
- **Test that doesn't test what it claims** — assertion doesn't match the test name
- **Real simplification** — duplicated code that will drift, two DB calls that should be one

### Document — issues that are intentional decisions

An issue should be documented (not fixed) if it meets ANY of these:
- **Architectural decision** — e.g. `--dangerously-skip-permissions` is intentional
- **Known limitation with a tracked TODO** — e.g. missing auth already has a TODO
- **Threat model boundary** — e.g. "prompt injection risk" when inputs come from trusted sources
- **Low-risk theoretical concern** — e.g. "file paths could be traversal attacks" but paths are never used for file access
- **Style/taste disagreement** — e.g. `else if` vs `else`, return type `Promise<unknown>` vs `Promise<void>`
- **Already tracked elsewhere** — issue exists in a backlog, another PR, or a TODO comment

For documented decisions: instruct the bot to add a comment in the code explaining the decision, so future review rounds don't re-flag it.

## Step 6: Post a Comment on the PR

The deliverable of this workflow is a **comment posted directly on the pull request** using `gh pr comment`. This is how @claude receives instructions to fix things.

### How to post

```bash
gh pr comment <number> --body "$(cat <<'EOF'
@claude Fix the remaining issues and document decisions:

## Fix these

1. **<concise title>** in `<file>` — <what's wrong and why it matters>.
   <code snippet showing the fix if non-obvious>

2. ...

## Do NOT fix these — add comments to document the decisions

N. **<concise title>** — <why this is intentional>. Add a comment:
   `// <comment text explaining the decision>`

N+1. ...
EOF
)"
```

Use a heredoc (`cat <<'EOF'`) to preserve markdown formatting and code blocks in the comment body.

### Comment Guidelines

- **Be specific** — include file paths, line numbers, and code snippets
- **Explain why** — not just what to change, but why it matters
- **Provide the fix** — give code snippets for non-obvious changes
- **Group related issues** — if two issues are in the same file/function, mention them together
- **Don't re-raise fixed issues** — only include issues that are still present in the current diff
- **Keep document-only items short** — one line for the decision, one line for the comment to add
- **Always start with `@claude`** — this triggers the bot to pick up the instructions

## Step 7: Verify After Fix

After the bot posts its fix confirmation, re-read the diff to verify:
- All "fix" items were actually addressed
- No new issues were introduced by the fixes
- "Document" items have the correct comments added
- Tests were updated if behavior changed

If new issues surface, repeat from Step 5 with only the new findings.

## Anti-Patterns to Avoid

- **Don't re-flag fixed issues** — always check the current diff before raising an issue
- **Don't fix style preferences** — `else if` vs `else`, trailing commas, etc. are not worth a review round
- **Don't request features** — a review fixes what's broken, not what could be better
- **Don't pile on** — if auth is missing and tracked as TODO, don't list every endpoint as a separate finding
- **Don't add unnecessary abstraction** — "extract this 2-line pattern" is only worth it if it appears 3+ times or will genuinely drift
- **Don't block on theoretical risks** — if the attack requires the attacker to already have DB write access, it's not a real finding
