# crewdeck

A dashboard for managing autonomous Claude Code agents across GitHub repositories.

## Prerequisites

- Docker & Docker Compose
- [Claude Code](https://claude.ai/claude-code) configured on host
- A [GitHub OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) (for GitHub authentication via Device Flow)

## Quick Start

```bash
docker compose up --build
```

- **Frontend**: http://localhost:9380
- **Backend API**: http://localhost:9381

On first access, the app prompts you to create an admin account. All subsequent requests require a valid session.

Data persists in a Docker volume across restarts. See [Running CrewDeck](docs/running.md) for details.

## Running Without Docker

**Backend:**

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

## Docs

- [Running CrewDeck](docs/running.md)
- [API Reference](docs/api.md)
- [Data Model](docs/data-model.md)
- [Agent Runtime](docs/agent-runtime.md)
- [Agent Orchestration](docs/agent-cli.md)
- [Design](docs/design.md)
