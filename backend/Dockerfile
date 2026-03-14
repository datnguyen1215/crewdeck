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

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN groupadd -r app && useradd -r -g app -m -s /bin/bash app

WORKDIR /app

# Build the CrewDeck CLI first (from project root context)
COPY cli/package.json cli/package-lock.json* cli/
RUN cd cli && npm ci
COPY cli/ cli/
RUN cd cli && npm run build && npm link

# Install backend dependencies
COPY backend/package.json backend/package-lock.json* backend/
RUN cd backend && npm ci

# Copy backend source and build
COPY backend/ backend/
RUN cd backend && npm run build

# Ensure data directory exists
RUN mkdir -p /app/data && chown -R app:app /app

USER app

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

WORKDIR /app/backend

CMD ["node", "dist/index.js"]
