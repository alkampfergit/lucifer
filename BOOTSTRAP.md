# Bootstrap Prompt

> **How to use:** Copy this entire file and paste it as a prompt to your AI coding assistant
> after forking or copying this template repository. The AI will ask you questions about
> your project and configure all placeholder documents automatically.

---

You are bootstrapping a new software project using an agent-first repository template.
Your job is to configure this repository for the user's specific project by filling in
all placeholder documents.

## Step 1: Gather Project Information

Ask the user the following questions, one at a time. Wait for each answer before proceeding.

1. **Project name**: What is this project called?
2. **Tech stack**: What language(s) and framework(s) will this project use?
3. **Architecture style**: Confirm layered domain architecture or ask if they prefer a different approach.
4. **Domains**: What are the initial business domains? For each domain, ask:
   - Name (single noun or short noun phrase)
   - Responsibility (one sentence)
   - Key concepts that belong exclusively to this domain
5. **Infrastructure**: What database, message bus, cache, and CI/CD platform will be used?
6. **Observability**: What logging/monitoring/tracing stack will be used (if any)?

## Step 2: Configure Architecture Docs

Using the answers from Step 1, fill in the following files. Replace all `[PLACEHOLDER]` values with project-specific content. Remove placeholder brackets entirely — the result should read as finished documentation.

### `AGENTS.md`
- Update the Identity section: project name, purpose, and style.
- Verify the "Where to Look" table links are correct.
- Update the "Last verified" date to today.

### `docs/architecture/ARCHITECTURE.md`
- Fill in the System Overview with the project name and architecture style.
- Populate the Domain Map table with all initial domains.
- Fill in the Infrastructure table with the chosen technologies.
- Reference the ADRs created in Step 4.

### `docs/architecture/DEPENDENCY-RULES.md`
- Adapt the layer names if the chosen architecture differs from the default.
- Ensure the dependency direction table matches the project's layer structure.

### `docs/architecture/DOMAIN-BOUNDARIES.md`
- Add a Domain Registry entry for each initial domain.
- Fill in responsibility, bounded context, published/consumed events, public API surface, and data ownership.
- Add initial integration contracts if domains interact.

## Step 3: Configure Quality and Context Docs

### `docs/quality/QUALITY-GRADES.md`
- Add a row for each initial domain with grade "B" (clean scaffold, no code yet).
- Set "Last Reviewed" to today's date.

### `docs/quality/CODE-STANDARDS.md`
- Add a language-specific section for the chosen tech stack.
- Include the linter and formatter commands.
- Adapt naming conventions if the language has different idioms.

### `docs/context/GLOSSARY.md`
- Add domain-specific terms for each initial domain.
- Fill in the definition and in-code representation columns.

### `docs/context/DECISIONS.md`
- Update ADR-001 and ADR-002 deciders with the project team or owner.
- Add any new ADRs for technology choices made during bootstrapping (e.g., "ADR-003: Use PostgreSQL for primary storage").

## Step 4: Generate Enforcement Scaffolding

Based on the chosen tech stack, generate:

1. **Linter configuration** — appropriate for the language (e.g., `.eslintrc`, `.editorconfig`, `ruff.toml`).
2. **Formatter configuration** — matching the code standards.
3. **CI/CD pipeline** — a basic pipeline config (e.g., `.github/workflows/ci.yml`) that runs:
   - Linting
   - Formatting check
   - Tests
   - Structural tests (dependency rule verification)
4. **Structural test stubs** — skeleton test files that verify dependency direction rules. These can start as TODOs with clear descriptions of what each test should check.

## Step 5: Scaffold Initial Domain Directories

For each domain defined in Step 1, create the directory structure:

```
src/domains/[domain-name]/
├── types/           # Value objects, DTOs, events, enums
├── config/          # Configuration schemas and defaults
├── repository/      # Data access interfaces and implementations
├── service/         # Business logic
├── runtime/         # DI wiring, bootstrap
└── README.md        # Domain-specific documentation
```

Adapt file extensions and directory layout to the chosen tech stack.

## Step 6: Final Verification

After all changes:

1. Verify every link in `AGENTS.md` points to a real file.
2. Verify no `[PLACEHOLDER]` or `[e.g.,` text remains in any doc.
3. Verify the README.md structure diagram matches the actual file tree.
4. Commit all changes with message: `feat: bootstrap project — [project-name]`

## Rules

- Do not skip any document. Every placeholder in every file must be resolved.
- Ask clarifying questions rather than guessing. Wrong assumptions waste more time than an extra question.
- Keep all documentation concise. Do not pad with generic filler text.
- Preserve the structure and formatting conventions already present in each file.
