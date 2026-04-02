# Running CrewDeck

This guide covers running CrewDeck using Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) configured on your host machine
- A GitHub account with an SSH key and Personal Access Token (PAT) with `repo` and `workflow` scopes

The following host directory **must exist** or the backend container will fail to start:

| Host Path   | Purpose                                             |
| ----------- | --------------------------------------------------- |
| `~/.claude` | Claude Code config (mounted read-only into backend) |

## Quick Start

```bash
docker compose up --build
```

- Frontend: http://localhost:9380
- Backend API: http://localhost:9381

## How It Works

Docker Compose runs two services using `network_mode: host`, so ports are bound directly on the host (no port mapping):

| Service    | Port | Description                               |
| ---------- | ---: | ----------------------------------------- |
| `frontend` | 9380 | SvelteKit production build (adapter-node) |
| `backend`  | 9381 | Express API + SQLite + agent runtime      |

Both services are self-contained — no host source code is mounted. The frontend is built during `docker build` and served by Node.

The backend container includes tmux, git, GitHub CLI, and Claude Code CLI so agents can run autonomously inside it.

When you add a repo to a project, the backend clones it automatically into its own data directory (`/app/data/repos` inside the container). You don't need to have repos on the host.

## Volumes

Application data (SQLite database and cloned repos) is stored in a named Docker volume `crewdeck-data`, which persists across container restarts and rebuilds.

The only host mount is for Claude Code configuration (read-only):

| Host Path   | Container Path           | Purpose            |
| ----------- | ------------------------ | ------------------ |
| `~/.claude` | `/home/app/.claude` (ro) | Claude Code config |

## Environment Variables

Docker Compose sets these automatically. You do **not** need a `.env` file for Docker.

**Backend** (set in `docker-compose.yml`):

| Variable             | Value                   | Purpose                                                               |
| -------------------- | ----------------------- | --------------------------------------------------------------------- |
| `DB_PATH`            | `/app/data/crewdeck.db` | SQLite database location                                              |
| `CREWDECK_REPOS_DIR` | `/app/data/repos`       | Where repos are cloned                                                |
| `MAX_AGENTS`         | `10`                    | Global concurrency limit (all projects)                               |
| `ANTHROPIC_API_KEY`  | _(your API key)_        | Anthropic API key (required for Captain LLM agent and Claude models). |
| `ZAI_API_KEY`        | _(optional)_            | Z.AI API key (required for GLM models).                               |

**Orchestration tuning** (optional, override defaults):

| Variable                                      | Default   | Purpose                                               |
| --------------------------------------------- | --------- | ----------------------------------------------------- |
| `ORCHESTRATION_BATCH_TIMEOUT_MS`              | `1800000` | Max time to wait for a batch of agents (30 min)       |
| `ORCHESTRATION_PTY_IDLE_TIMEOUT_MS`           | `1800000` | PTY session idle timeout before cleanup (30 min)      |
| `ORCHESTRATION_PROCESS_GRACE_PERIOD_MS`       | `5000`    | SIGTERM→SIGKILL grace period (5 s)                    |
| `ORCHESTRATION_DEFAULT_AGENT_TIMEOUT_MINUTES` | `10`      | Default agent run timeout in minutes                  |
| `ORCHESTRATION_BATCH_CLEANUP_INTERVAL_MS`     | `300000`  | How often stale batches are cleaned up (5 min)        |
| `ORCHESTRATION_PR_POLL_INTERVAL_MS`           | `60000`   | How often PR status is polled (60 s)                  |
| `ORCHESTRATION_EVENT_BATCHING_WINDOW_MS`      | `5000`    | Captain event batching window (5 s)                   |
| `ORCHESTRATION_SERVER_RECOVERY_DELAY_MS`      | `2000`    | Delay before startup recovery runs (2 s)              |
| `ORCHESTRATION_STARTUP_BUFFER_MS`             | `500`     | Buffer after recovery before scanning issues (500 ms) |
| `ORCHESTRATION_MAX_CONTEXT_MESSAGES`          | `10`      | Max monitor conversation messages kept in context     |

**Frontend**:

| Variable           | Value                   | Purpose         |
| ------------------ | ----------------------- | --------------- |
| `VITE_BACKEND_URL` | `http://localhost:9381` | Backend API URL |

## Rebuilding

After pulling new changes or modifying dependencies:

```bash
docker compose up --build
```

To do a clean rebuild (e.g. after dependency changes):

```bash
docker compose down
docker compose build --no-cache
docker compose up
```

## Stopping

```bash
docker compose down
```

Data persists in the `crewdeck-data` Docker volume between restarts. To remove all data:

```bash
docker compose down -v
```

## Logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f backend
docker compose logs -f frontend
```

## Troubleshooting

**GitHub authentication**: GitHub accounts are added in-app (Accounts page) by providing an SSH private key and a Personal Access Token (PAT) with `repo` and `workflow` scopes. Each project links to an account for per-project credential isolation. You do not need `gh auth login` or machine-wide SSH config on your host.

**Claude Code not working**: Ensure `~/.claude` exists on your host with valid configuration.
