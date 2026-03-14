# Running CrewDeck

This guide covers running CrewDeck using Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- [GitHub CLI](https://cli.github.com/) authenticated (`gh auth login`) on your host machine
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) configured on your host machine

The following host directories **must exist** or the backend container will fail to start:

| Host Path      | Purpose                                        |
|----------------|-------------------------------------------------|
| `~/.claude`    | Claude Code config (mounted read-only into backend) |
| `~/.config/gh` | GitHub CLI auth (mounted read-only into backend)    |

## Quick Start

```bash
docker compose up --build
```

- Frontend: http://localhost:9380
- Backend API: http://localhost:9381

## How It Works

Docker Compose runs two services:

| Service    | Container Port | Host Port | Description                        |
|------------|---------------:|----------:|------------------------------------|
| `frontend` |           5173 |      9380 | SvelteKit dev server (hot reload)  |
| `backend`  |           3000 |      9381 | Express API + SQLite + agent runtime |

The backend container includes tmux, git, GitHub CLI, and Claude Code CLI so agents can run autonomously inside it.

When you add a repo to a project, the backend clones it automatically into its own data directory (`/app/data/repos` inside the container). You don't need to have repos on the host.

## Volume Mounts

The backend mounts several host paths:

| Host Path      | Container Path              | Purpose                        |
|----------------|-----------------------------|--------------------------------|
| `./data`       | `/app/data`                 | SQLite database + cloned repos |
| `~/.claude`    | `/home/app/.claude` (ro)    | Claude Code config             |
| `~/.config/gh` | `/home/app/.config/gh` (ro) | GitHub CLI auth                |

The frontend mounts `./frontend` into the container for live development with hot reload.

## Environment Variables

Docker Compose sets these automatically. You do **not** need a `.env` file for Docker.

**Backend** (set in `docker-compose.yml`):

| Variable              | Value                    | Purpose                        |
|-----------------------|--------------------------|--------------------------------|
| `CORS_ORIGIN`        | `http://localhost:9380`  | Allowed CORS origin (frontend) |
| `DB_PATH`            | `/app/data/crewdeck.db`  | SQLite database location       |
| `CREWDECK_REPOS_DIR` | `/app/data/repos`        | Where repos are cloned         |

**Frontend**:

| Variable           | Value                 | Purpose         |
|--------------------|-----------------------|-----------------|
| `VITE_BACKEND_URL` | `http://backend:3000` | Backend API URL |

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

Data persists in `./data/` between restarts.

## Logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f backend
docker compose logs -f frontend
```

## Troubleshooting

**Port conflicts**: If ports 9380 or 9381 are in use, change the host port in `docker-compose.yml`:
```yaml
ports:
  - "NEW_PORT:5173"  # frontend
  - "NEW_PORT:3000"  # backend
```

**Permission errors on `./data`**: Ensure the directory is writable. The backend runs as a non-root `app` user (UID 999).

**GitHub CLI not working in container**: Make sure `gh auth login` is complete on your host and `~/.config/gh` exists.

**Claude Code not working**: Ensure `~/.claude` exists on your host with valid configuration.
