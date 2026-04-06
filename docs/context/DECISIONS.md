# Architecture Decision Records (ADRs)

> Every significant architectural decision is recorded here.
> An ADR captures what was decided, why it was decided, and what alternatives were rejected.

## When to Write an ADR

Write an ADR when:
- A new technology, library, or framework is adopted.
- A structural pattern is chosen over alternatives.
- A domain boundary is created, split, or merged.
- A dependency rule exception is granted.
- A convention is established that future code must follow.

## Active ADRs

---

## ADR-001: Use Vite React frontend with an Express delivery tier

**Date**: 2026-04-06
**Status**: Accepted
**Deciders**: alkampfergit

### Context

Lucifer starts from an empty repository and needs a Node + React web application that is simple to run locally, straightforward for agents to reason about, and easy to deploy to Azure.

### Decision

Use Vite + React + TypeScript for the frontend and an Express + TypeScript server for the API and production asset hosting.

### Consequences

- (+) Fast frontend developer experience with a boring, well-known toolchain.
- (+) A single Node runtime fits naturally in a container image for Azure Container Apps.
- (-) Frontend and backend build outputs must be coordinated in CI.

### Alternatives Considered

- **Next.js**: Rejected to keep the starter lighter and closer to a generic Node + React baseline.
- **Separate frontend and backend deployments**: Rejected for the initial scaffold because it adds unnecessary deployment complexity.

---

## ADR-002: Initialize the repository with the ai-landscape harness-engineering template

**Date**: 2026-04-06
**Status**: Accepted
**Deciders**: alkampfergit

### Context

The repository should start with reusable instructions, architecture docs, quality checklists, and skills so coding agents can work effectively from the first change.

### Decision

Copy the ai-landscape template into Lucifer and customize the key architecture, quality, and context documents for this project.

### Consequences

- (+) The repository begins with a complete harness-engineering layout instead of ad hoc notes.
- (+) Future work can evolve from documented architecture and review expectations.
- (-) The docs must be maintained as the application grows.

### Alternatives Considered

- **Minimal README-only setup**: Rejected because it does not provide enough structure for agent-driven development.
- **Invent a new doc layout**: Rejected because the template already encodes the desired patterns.

---

## ADR-003: Deploy Docker images through Azure Container Apps with GitHub Actions

**Date**: 2026-04-06
**Status**: Accepted
**Deciders**: alkampfergit

### Context

The app needs a deployment path to Azure that fits a single Node runtime, embraces containerization, and can be automated from GitHub.

### Decision

Build a Docker image from the repository and deploy it to Azure Container Apps using GitHub Actions plus Azure credentials and Azure Container Registry.

### Consequences

- (+) Deployment stays close to the application runtime and uses the same Docker artifact across environments.
- (+) CI and deployment conventions are visible in the repository.
- (-) Deployment requires repository-level Azure credentials and registry configuration.

### Alternatives Considered

- **Azure App Service source deployment**: Rejected because the project now standardizes on container delivery.
- **Manual portal deployments**: Rejected because they are harder to reproduce and review.
