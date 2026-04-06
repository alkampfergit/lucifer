# Lucifer

Lucifer is a starter Node + React web application bootstrapped with the ai-landscape harness-engineering template. It ships with a Vite frontend, an Express backend, CI checks, and an Azure App Service deployment workflow.

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

## Azure deployment

The repo includes `.github/workflows/azure-webapp.yml` for Azure App Service deployment.

Configure these GitHub settings before using it:

- Repository variable: `AZURE_WEBAPP_NAME`
- Repository secret: `AZURE_WEBAPP_PUBLISH_PROFILE`

Then either push to `main` or trigger the workflow manually. Azure should use `npm start` as the startup command.

## Repository structure

```text
.
├── .claude/
│   └── skills/
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── copilot-instructions.md
│   └── workflows/
│       ├── azure-webapp.yml
│       └── ci.yml
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
├── README.md
└── package.json
```

## Harness engineering template

The ai-landscape template files are included so the repository starts with the full harness-engineering layout: canonical agent instructions, quality and architecture docs, task workflows, templates, and reusable skills.
