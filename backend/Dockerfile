FROM node:22-bookworm

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    git \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Claude Code CLI — unpinned intentionally; always use the latest release.
# Agents need the latest tool support and model compatibility.
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN groupadd -r app && useradd -r -g app -m -s /bin/bash app

WORKDIR /app

# Install backend dependencies
COPY backend/package.json backend/package-lock.json* backend/
RUN cd backend && npm ci

# Copy backend source and build
COPY backend/ backend/
RUN cd backend && npm run build

# Ensure data directories exist and app user can write to them
# /app/data — DB and repos (Docker volume mount point)
# /app/backend/data — log files (default LOG_FILE_PATH is ./data/server.log)
RUN mkdir -p /app/data /app/backend/data \
    && chown app:app /app/data /app/backend/data

# Copy host Claude config so agents have a writable, independent ~/.claude
COPY --from=claude-config --chown=app:app / /home/app/.claude/

# Restore .claude.json from backup if the host didn't provide it directly.
# Claude CLI expects ~/.claude.json at the home root; the backup lives inside
# ~/.claude/backups/ which is already copied above.
RUN latest=$(ls -t /home/app/.claude/backups/.claude.json.backup.* 2>/dev/null | head -1) \
    && if [ -n "$latest" ]; then cp "$latest" /home/app/.claude.json && chown app:app /home/app/.claude.json; fi

USER app

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/backend

CMD ["node", "dist/index.js"]
