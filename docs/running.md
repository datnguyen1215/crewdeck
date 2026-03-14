# Running CrewDeck

This guide covers running CrewDeck using Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [GitHub CLI](https://cli.github.com/) authenticated (`gh auth login`) on your host machine
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) configured on your host machine

The following host directories **must exist** or the backend container will fail to start:

| Host Path      | Purpose                                             |
| -------------- | --------------------------------------------------- |
| `~/.claude`    | Claude Code config (mounted read-only into backend) |
| `~/.config/gh` | GitHub CLI auth (mounted read-only into backend)    |

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

The only host mounts are for authentication (read-only):

| Host Path      | Container Path              | Purpose            |
| -------------- | --------------------------- | ------------------ |
| `~/.claude`    | `/home/app/.claude` (ro)    | Claude Code config |
| `~/.config/gh` | `/home/app/.config/gh` (ro) | GitHub CLI auth    |

## Environment Variables

Docker Compose sets these automatically. You do **not** need a `.env` file for Docker.

**Backend** (set in `docker-compose.yml`):

| Variable             | Value                   | Purpose                        |
| -------------------- | ----------------------- | ------------------------------ |
| `CORS_ORIGIN`        | `http://localhost:9380` | Allowed CORS origin (frontend) |
| `DB_PATH`            | `/app/data/crewdeck.db` | SQLite database location       |
| `CREWDECK_REPOS_DIR` | `/app/data/repos`       | Where repos are cloned         |

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

**GitHub CLI not working in container**: Make sure `gh auth login` is complete on your host and `~/.config/gh` exists.

**Claude Code not working**: Ensure `~/.claude` exists on your host with valid configuration.
