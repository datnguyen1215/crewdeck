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

# Use the built-in 'node' user (uid 1000) from the base image.
# This matches the typical host UID so bind-mounted credential files
# (e.g. ~/.claude/.credentials.json) are readable without chown.

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
    && chown node:node /app/data /app/backend/data

# Create writable ~/.claude directory for Claude CLI runtime files.
# Credential files are mounted at runtime via docker-compose volume mounts.
RUN mkdir -p /home/node/.claude && chown node:node /home/node/.claude

USER node

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/backend

CMD ["node", "dist/index.js"]
