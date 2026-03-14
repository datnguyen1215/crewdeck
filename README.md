# crewdeck

A dashboard for managing autonomous Claude Code agents across GitHub repositories.

## Prerequisites

- Docker & Docker Compose
- [GitHub CLI](https://cli.github.com/) authenticated (`gh auth login`)
- [Claude Code](https://claude.ai/claude-code) configured on host

## Quick Start

```bash
docker compose up --build
```

- **Frontend**: http://localhost:9380
- **Backend API**: http://localhost:9381

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
- [Agent CLI](docs/agent-cli.md)
- [Design](docs/design.md)
