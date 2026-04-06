# Glossary

> Shared terms used across Lucifer docs and code.

| Term | Definition | In-code representation |
|---|---|---|
| `web-shell` | The React application rendered in the browser | `src/domains/web-shell/*` |
| `platform-api` | The Express application that exposes HTTP endpoints and serves the build output | `server/src/domains/platform-api/*` |
| `health report` | The runtime status document returned by `/api/health` | `HealthReport` / `HealthStatus` |
| `container app` | Azure-managed containerized application target for the deployed service | `AZURE_CONTAINER_APP_NAME` variable |
| `Azure credentials` | Service principal JSON used by GitHub Actions to authenticate Azure deployment steps | `AZURE_CREDENTIALS` secret |
| `harness engineering` | The practice of encoding agent guidance and checks in the repository | `AGENTS.md`, `docs/`, `.claude/skills/` |
