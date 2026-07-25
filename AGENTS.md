# Agent Instructions

## Package Management

- Use pnpm. Do not use npm or Yarn.
- Keep dependencies pinned to exact versions.
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

- Keep host permissions limited to exact required npmjs.com hosts.
- Do not add remote code, telemetry, analytics, or network fetches.
- Keep installed extension code readable and unminified.
- Load extension unpacked for personal use; do not add store publication or
  enterprise deployment workflows.
