# Browser extensions

Private Chromium extension monorepo managed with pnpm workspaces and
Turborepo.

## Extensions

| Extension                                                                         | Description                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [`npmjs-to-npmx`](extensions/npmjs-to-npmx)                                       | Redirect compatible npmjs.com pages to npmx.dev.               |
| [`page-screenshot`](extensions/page-screenshot)                                   | Capture viewport and full-page screenshots.                    |
| [`Reading List`](extensions/reading-list-exporter)                                | Import, export, and clear Chrome Reading List entries.         |
| [`servicenow-advanced-service-view`](extensions/servicenow-advanced-service-view) | Redirect ServiceNow application services to the advanced view. |
| [`Tessera`](extensions/tessera)                                                   | Build a nested, local-only new tab workspace.                  |

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
with all built extensions loaded unpacked.

Root builds rewrite the generated archives with fixed timestamps and entry
ordering for deterministic, cross-platform ZIP output.

Run one extension task with a workspace filter:

```sh
pnpm --filter @browser-extensions/npmjs-to-npmx build
```

See each extension directory for unpacked installation instructions.

To install a packaged stable or canary build, see
[Install an extension from a release](docs/install-from-release.md).

## Releases

The monorepo has one shared release version. Every release contains a ZIP for
each extension plus a `SHA256SUMS` file. Generated `dist/` directories and
release assets are never committed.

Repository release immutability is supported: each workflow builds and
validates every asset before `gh release create` uploads them to a draft and
publishes it. After publication, its tag and assets are not replaced or edited;
a corrected build receives a new canary release.

### Initial version tag

Version calculation requires a stable tag. Before enabling the release
workflows, create a one-time `v1.0.0` tag on the current `main` commit that
represents the versions in the source manifests:

```sh
git fetch origin main
git tag v1.0.0 origin/main
git push origin v1.0.0
```

The baseline tag does not need its own GitHub release. If the release workflows
have already been merged, put the baseline tag on the commit immediately before
the release-system merge instead.

### Canary releases

Every push to `main` runs the **Canary release** workflow. It validates and
builds all extensions, creates a tag such as `v1.2.0-canary.4`, and publishes a
GitHub prerelease with generated release notes and versioned ZIP attachments.
Canary releases are explicitly excluded from the repository's `latest` release.

The prospective stable version is calculated from Conventional Commits since
the latest stable tag:

| Commit since the stable tag                       | Version change |
| ------------------------------------------------- | -------------- |
| `type!:` or a `BREAKING CHANGE:` footer           | Major          |
| At least one `feat:`                              | Minor          |
| `fix:`, `perf:`, or only other conventional types | Patch          |

The canary number is the total commit count at that point in `main`, making the
tag deterministic and unique for a given commit. The generated Chrome version
uses the smaller commit count since the previous stable tag for its fourth
numeric component.

### Stable releases

Run the **Stable release** workflow manually from the `main` branch and enter a
canary tag in the `candidate_tag` field. GitHub Actions cannot dynamically fill
a workflow input with repository tags, so this is a validated text field rather
than a dropdown.

The workflow only promotes a candidate when all of the following are true:

- Its tag resolves to a published GitHub prerelease.
- Its commit is contained in `main`.
- Its tag matches the version calculated for that commit.
- Its commit contains the current stable tag and is not stale.
- The corresponding stable tag does not already exist.

Promoting `v1.2.0-canary.4` rebuilds the same commit as `v1.2.0`, creates that
stable tag, generates release notes from the previous stable tag, attaches the
rebuilt extensions, publishes an official release, and explicitly marks it as
`latest`.

### Extension manifest versions

Chrome requires `manifest.json` versions to contain only numeric components.
Release builds therefore stamp only the generated manifests:

```json
{
  "version": "1.1.0.4",
  "version_name": "1.2.0-canary.27"
}
```

The example canary follows stable `v1.1.0` and targets `v1.2.0`. Its numeric
version is newer than the previous stable build but older than the eventual
`1.2.0` stable build. The `27` is its repository-wide canary number, while `4`
means it is four commits beyond `v1.1.0`. Source manifests are not changed
during a release.

To prepare release assets locally after calculating their metadata, run:

```sh
pnpm run build:release -- \
  --tag v1.2.0-canary.27 \
  --browser-version 1.1.0.4 \
  --version-name 1.2.0-canary.27 \
  --output-directory release-assets
```
