# Browser extensions

Private Chromium extension monorepo managed with pnpm workspaces and
Turborepo.

## Extensions

| Extension                                          | Description                                            |
| -------------------------------------------------- | ------------------------------------------------------ |
| [`npmjs-to-npmx`](extensions/npmjs-to-npmx)        | Redirect compatible npmjs.com pages to npmx.dev.       |
| [`page-screenshot`](extensions/page-screenshot)    | Capture viewport and full-page screenshots.            |
| [`Reading List`](extensions/reading-list-exporter) | Import, export, and clear Chrome Reading List entries. |
| [`Tessera`](extensions/tessera)                    | Build a nested, local-only new tab workspace.          |

## Requirements

- Node.js 24 or newer
- pnpm 11.17.0
- `zip` for the extension workspace build scripts; root archive normalization
  and validation do not require `unzip`
- Chrome for Testing or Chromium for the unpacked-extension smoke test

## Commands

```sh
pnpm install --frozen-lockfile
pnpm validate
```

`pnpm validate` checks formatting without changing files, then runs lint, type
checking, build, tests, and exact ZIP-content checks. Run `pnpm format` to apply
formatting and `pnpm smoke:chromium` to launch Chrome for Testing or Chromium
with all four built extensions loaded unpacked.

Root builds rewrite the generated archives with fixed timestamps and entry
ordering for deterministic, cross-platform ZIP output.

Run one extension task with a workspace filter:

```sh
pnpm --filter @browser-extensions/npmjs-to-npmx build
```

See each extension directory for unpacked installation instructions.
