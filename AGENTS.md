# Agent Instructions

## Package Management

- Use pnpm. Do not use npm or Yarn.
- Keep dependencies pinned to exact versions.
- Use pnpm workspaces and Turborepo for extension packages and tasks.
- Keep each extension under `extensions/<extension-name>`.
- Avoid runtime dependencies unless extension cannot reasonably work without
  them.

## Validation

- Run `pnpm validate` after code or documentation changes.
- Before making any commit, run `pnpm validate` and confirm it passes.
- Do not commit generated `dist/` or browser-generated `_metadata/` files.

## Commits

- Use Conventional Commits.
- Format: `<type>(optional-scope): <description>`.
- Common types: `feat`, `fix`, `docs`, `test`, `build`, `ci`, `chore`, and
  `refactor`.
- Keep descriptions concise, imperative, and lowercase.
- Do not amend or create commits unless user explicitly requests it.

## Extension Security

- Keep host permissions limited to exact hosts required by each extension.
- Do not add remote code, telemetry, analytics, or network fetches.
- Write extension runtime code in strict TypeScript and compile it to readable,
  unminified JavaScript.
- Load extension unpacked for personal use; do not add store publication or
  enterprise deployment workflows.
