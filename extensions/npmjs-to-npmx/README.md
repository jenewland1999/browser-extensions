# npmjs to npmx

Auditable Chromium extension that redirects compatible `npmjs.com` pages to
`npmx.dev`. Paths, query strings, and fragments stay intact.

Examples:

| From                                  | To                               |
| ------------------------------------- | -------------------------------- |
| `https://www.npmjs.com/package/react` | `https://npmx.dev/package/react` |
| `http://npmjs.com/search?q=test`      | `https://npmx.dev/search?q=test` |

## Security design

- Manifest V3.
- Four static `declarativeNetRequest` rulesets, evaluated by browser.
- Access limited to `npmjs.com` and `www.npmjs.com`.
- Top-level page navigation only. Subresources, API calls, and npm registry
  traffic remain untouched.
- Small local service worker, popup, and content script support settings,
  address-bar shortcuts, and npm single-page navigations.
- No analytics, network fetches, remotely hosted code, or third-party code.
- No runtime dependencies. Development uses pinned Oxfmt and Oxlint versions.
- Build archive includes only reviewed runtime files listed by packaging code.

These choices reduce attack surface. Development dependencies never ship in
installed extension; lockfile and exact version pins make changes reviewable.

## Install unpacked

### Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Run `pnpm build` from repository root.
5. Select `extensions/npmjs-to-npmx/dist`.
6. Visit `https://www.npmjs.com/package/react` and confirm destination is
   `https://npmx.dev/package/react`.

### Microsoft Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Run `pnpm build` from repository root.
5. Select `extensions/npmjs-to-npmx/dist`.
6. Run same navigation check.

### Helium

Helium is Chromium-based. Run `pnpm build`, open its extensions page, enable
developer mode, load `extensions/npmjs-to-npmx/dist` unpacked, then run same
navigation check. Helium remains beta; test each release you use.

Repeat these steps for each browser profile. Unpacked extensions require
Developer mode and do not automatically propagate between profiles.

## Test

Requires Node.js 24 or newer and pnpm. CI tests Node.js 24 and 26.

```sh
pnpm install --frozen-lockfile
pnpm --filter @browser-extensions/npmjs-to-npmx test
```

Root `pnpm validate` formats all files, then runs lint, strict TypeScript type
checking, build, and test tasks across monorepo. Tests verify permission scope,
static rule shape, URL preservation, settings, omnibox behavior, and rejection
of lookalike domains. Also load compiled `dist` directory in each target
browser: browser performs final schema validation, and Chromium forks can
differ.

## Build and audit

On macOS/Linux with `zip` installed:

```sh
pnpm --filter @browser-extensions/npmjs-to-npmx build
unzip -l extensions/npmjs-to-npmx/dist/npmjs-to-npmx.zip
shasum -a 256 extensions/npmjs-to-npmx/dist/npmjs-to-npmx.zip
```

Build compiles `src/*.ts` into readable JavaScript, copies static extension
files into `dist`, and creates archive. Inspect archive against file list in
`extensions/npmjs-to-npmx/scripts/build.mjs`. Archive is optional for personal
use because browsers load `dist` directly. Do not add runtime dependencies or
minified code.

## Features

- Redirect package, search, user, and organization pages.
- Preserve URL path, query, and fragment.
- Toggle all redirects or each route group from extension popup.
- Type `npmx`, press `Tab`, then enter package name in address bar.
- Prefix omnibox query with `search`, `s`, or `?` to search npmx.
- Handle npm client-side navigation without redirecting other site routes.

This matches functional scope of open-source `npmx-redirect` version 0.2.0,
audited July 25, 2026, while avoiding its framework and runtime dependencies.

## Scope decisions

Redirects mean browser page navigations. Redirecting every network request
would send npm-hosted scripts, images, API calls, or other resources to paths
that npmx may not serve. It would also alter third-party pages using npm assets.
Restricting rule to `main_frame` gives intended site replacement without that
breakage.

Only bare and `www` hosts redirect. Domains such as `registry.npmjs.org` and
arbitrary `*.npmjs.com` subdomains are intentionally excluded.

Unsupported npm routes, including `/settings/*`, stay on npm. npmx documents
those routes as unsupported. Homepage also stays on npm, matching audited
extension behavior.

## Updating

1. Change files directly; avoid adding dependencies unless unavoidable.
2. Increase `version` in `extensions/npmjs-to-npmx/manifest.json` and its
   `package.json`.
3. Run `pnpm validate`.
4. Reload compiled `dist` extension from each browser's extensions page.
5. Test Chrome, Edge, and Helium profiles where extension is installed.

## Primary sources

Researched July 25, 2026:

- [Chrome declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Chrome permission declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome extension security guidance](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
- [Chrome remote-hosted-code policy](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code)
- [Chrome extension end-to-end testing](https://developer.chrome.com/docs/extensions/how-to/test/end-to-end-testing)
- [Microsoft Edge Chrome extension porting guide](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)
- [Helium source repository](https://github.com/imputnet/helium)
- [npmx brand assets](https://npmx.dev/brand)
- [npmx redirect source](https://github.com/iaverages/npmx-redirect)
