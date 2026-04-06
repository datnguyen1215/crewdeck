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

Open http://localhost:9380. On first access, the app prompts you to create an admin account.

Data persists in a Docker volume across restarts. See [Running CrewDeck](docs/running.md) for details.

### Android Toolchain

For projects that need JDK, Android SDK/NDK, Go, and gomobile (e.g., ScreenBeam):

```bash
docker compose -f docker-compose.yml -f docker-compose.android.yml up --build
```

This swaps the backend with a heavier image (~5-6 GB) that includes JDK 17, Android SDK (platform 35, build-tools 35.0.0), NDK 30, Go 1.24, and gomobile. First build is slow; subsequent builds use Docker cache.

To switch back to the lightweight image, run the normal command:

```bash
docker compose up --build
```

### Exposing to the Internet

To expose CrewDeck via a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

1. Copy `.env.example` to `.env` and set your `TUNNEL_TOKEN`
2. Run with the `tunnel` profile:

```bash
docker compose --profile tunnel up --build
```

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
