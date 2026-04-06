# Lucifer

Lucifer is a starter Node + React web application bootstrapped with the ai-landscape harness-engineering template. It ships with a Vite frontend, an Express backend, CI checks, a Docker image, and an Azure Container Apps deployment workflow.

## Stack

- React 19 + Vite 8
- Express 5 on Node.js
- TypeScript
- Vitest + Testing Library + Supertest
- GitHub Actions for CI and Azure deployment

## Getting started

```bash
npm install
npm run dev
```

The Vite frontend runs on `http://localhost:5173` and proxies `/api/*` requests to the Express server on `http://localhost:3001`.

## Available scripts

- `npm run dev` — run frontend and backend together
- `npm run build` — run structural checks and create production assets
- `npm run start` — serve the built app from `dist/server`
- `npm run lint` — run ESLint across the repo
- `npm run test` — run unit and integration tests
- `npm run check:structure` — verify layered domain imports
- `docker build -t lucifer:test .` — build the production container locally

## Azure deployment

The repo includes `.github/workflows/azure-container-apps.yml` for Azure Container Apps deployment via Docker.

Configure these GitHub settings before using it:

- Repository secret: `AZURE_CREDENTIALS`
- Repository variable: `AZURE_CONTAINER_APP_NAME`
- Repository variable: `AZURE_CONTAINER_APP_ENVIRONMENT`
- Repository variable: `AZURE_CONTAINER_REGISTRY_NAME`
- Repository variable: `AZURE_RESOURCE_GROUP`

Then either push to `main` or trigger the workflow manually. The workflow builds the Docker image from `Dockerfile`, pushes it to Azure Container Registry, and updates the target Container App.

## Repository structure

```text
.
├── .claude/
│   └── skills/
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── copilot-instructions.md
│   └── workflows/
│       ├── azure-container-apps.yml
│       └── ci.yml
├── .dockerignore
├── docs/
│   ├── architecture/
│   ├── context/
│   ├── design/
│   ├── quality/
│   ├── superpowers/
│   └── workflows/
├── server/
│   └── src/
├── scripts/
│   └── check-dependencies.mjs
├── src/
│   ├── app/
│   ├── domains/
│   └── test/
├── AGENTS.md
├── BOOTSTRAP.md
├── CLAUDE.md
├── Dockerfile
├── README.md
└── package.json
```

## Harness engineering template

The ai-landscape template files are included so the repository starts with the full harness-engineering layout: canonical agent instructions, quality and architecture docs, task workflows, templates, and reusable skills.
