# Browser extensions

Private Chromium extension monorepo managed with pnpm workspaces and
Turborepo.

## Extensions

| Extension                                       | Description                                      |
| ----------------------------------------------- | ------------------------------------------------ |
| [`npmjs-to-npmx`](extensions/npmjs-to-npmx)     | Redirect compatible npmjs.com pages to npmx.dev. |
| [`page-screenshot`](extensions/page-screenshot) | Capture viewport and full-page screenshots.      |
| [`Tessera`](extensions/structured-start)        | Build a nested, local-only new tab workspace.    |

## Requirements

- Node.js 24 or newer
- pnpm 11.17.0
- `zip` for extension archives

## Commands

```sh
pnpm install --frozen-lockfile
pnpm validate
```

`pnpm validate` formats repository, then runs lint, type checking, build, and
test tasks across all extension workspaces through Turborepo.

Run one extension task with a workspace filter:

```sh
pnpm --filter @browser-extensions/npmjs-to-npmx build
```

See each extension directory for unpacked installation instructions.
