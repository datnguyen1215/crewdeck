# Running CrewDeck

This guide covers running CrewDeck using Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) configured on your host machine
- A GitHub account with an SSH key and Personal Access Token (PAT) with `repo` and `workflow` scopes

The following host files **must exist** before starting. If they don't, Docker will silently create them as empty directories, causing Claude CLI to fail at runtime with confusing errors:

| Host Path                     | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `~/.claude/.credentials.json` | Claude Code OAuth credentials (shared read-write with container) |
| `~/.claude.json`              | Claude Code session config (shared read-write with container)    |

## Quick Start

```bash
docker compose up --build
```

- Frontend: http://localhost:9380
- Backend API: http://localhost:9381

## First-Time Setup

On first launch (when no admin user exists), visiting the app automatically redirects to `/register` to create an admin account. The flow is:

1. Open http://localhost:9380
2. Redirected to `/register` — create an admin username and password
3. Redirected to `/login` — sign in with the credentials you just created
4. Redirected to `/setup/preflight` — a preflight wizard runs sequential checks: Claude CLI installation, Claude authentication, and Z.AI API key configuration. Each step shows real-time status and provides retry or skip options.
5. After completing the preflight check, click "Continue to Dashboard" to proceed to the dashboard. The root URL `/` automatically redirects here. On first visit, the Create Project modal opens to guide you through creating your first project.

Subsequent visits require signing in at `/login`.

## How It Works

Docker Compose runs five services on a bridge network. Only the Caddy reverse proxy exposes a port to the host:

| Service       | Internal Port | Published | Description                                |
| ------------ | ------------: | --------- | ------------------------------------------ |
| `caddy`      |          9380 | 9380      | Reverse proxy (exposed to host)            |
| `frontend`   |          3000 | —         | SvelteKit production build (adapter-node)  |
| `backend`    |          9381 | —         | Express API + SQLite + agent runtime       |
| `postgres`   |          5432 | —         | PostgreSQL 16 (internal only)              |
| `cloudflared`|              | —         | Cloudflare Tunnel (optional, `network_mode: host`) |

Caddy routes `/ws` and `/terminal-ws` (WebSocket) requests to the backend, and everything else to the frontend. Only port 9380 is published to the host — the other services are not directly accessible. PostgreSQL is reachable only from other containers on the Docker network at `postgres:5432`.

Both services are self-contained — no host source code is mounted. The frontend is built during `docker build` and served by Node. Claude credential files (`~/.claude/.credentials.json` and `~/.claude.json`) are mounted read-write so the container and host share live tokens.

The backend container includes tmux, git, GitHub CLI, and Claude Code CLI so agents can run autonomously inside it.

When you add a repo to a project, the backend clones it automatically into its own data directory (`/app/data/repos` inside the container). You don't need to have repos on the host.

## Volumes

Application data (SQLite database and cloned repos) is stored in a named Docker volume `crewdeck-data`, which persists across container restarts and rebuilds. PostgreSQL data is stored in a separate named volume `crewdeck-pgdata`.

Claude credential files are mounted read-write so the container and host share live tokens:

| Host Path                     | Container Path                            | Purpose                        |
| ----------------------------- | ----------------------------------------- | ------------------------------ |
| `~/.claude/.credentials.json` | `/home/node/.claude/.credentials.json` (rw) | Claude OAuth tokens (shared)   |
| `~/.claude.json`              | `/home/node/.claude.json` (rw)              | Claude session config (shared) |

## Environment Variables

Docker Compose sets these automatically. You do **not** need a `.env` file for Docker.

**Backend** (set in `docker-compose.yml`):

| Variable               | Value                   | Purpose                                                                                         |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `DB_PATH`              | `/app/data/crewdeck.db` | SQLite database location                                                                        |
| `CREWDECK_REPOS_DIR`   | `/app/data/repos`       | Where repos are cloned                                                                          |
| `POSTGRES_HOST`        | `postgres`              | PostgreSQL host (internal Docker service name)                                                   |
| `POSTGRES_PORT`        | `5432`                  | PostgreSQL port                                                                                 |
| `POSTGRES_USER`        | `crewdeck`              | PostgreSQL superuser username                                                                   |
| `POSTGRES_PASSWORD`    | `crewdeck`              | PostgreSQL superuser password                                                                   |
| `SESSION_EXPIRY_HOURS` | `168` (7 days)          | _(No longer used)_ Sessions persist indefinitely; cookie `maxAge` is set to 10 years.           |
| `ANTHROPIC_API_KEY`    | _(your API key)_        | Anthropic API key (required for Captain LLM agent and default Claude provider)                  |
| `ZAI_API_KEY`          | _(optional)_            | Z.AI API key (required if using GLM provider). Enables GLM option in Crew page provider toggle. |

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

| Variable           | Value                 | Purpose                                   |
| ------------------ | --------------------- | ----------------------------------------- |
| `VITE_BACKEND_URL` | `http://backend:9381` | Backend API URL (internal Docker network) |

## Exposing to the Internet (Optional)

CrewDeck includes an optional [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) service for public access without port forwarding.

1. Create a Cloudflare Tunnel and get your tunnel token
2. Copy `.env.example` to `.env` and set `TUNNEL_TOKEN`
3. Configure a public hostname in the Cloudflare dashboard pointing to `localhost:9380`
4. Run with the `tunnel` profile:

```bash
docker compose --profile tunnel up --build
```

The `cloudflared` service runs with `network_mode: host` so it can reach the published Caddy port.

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

Data persists in the `crewdeck-data` and `crewdeck-pgdata` Docker volumes between restarts. To remove all data:

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

**Claude Code not working**: Ensure `~/.claude/.credentials.json` and `~/.claude.json` exist on your host with valid Claude authentication.
