# Security Policy

## Reporting

Do not publish suspected vulnerabilities before fix is available. Report them
privately to repository owner using GitHub private vulnerability reporting, if
enabled, or another private contact channel listed on owner's profile.

Include affected version, reproduction steps, impact, and suggested fix.

## Threat model

Main risks:

- Permission expansion in future release.
- Added build dependencies or generated code hiding unwanted behavior.
- Redirect rule matching unintended domains or resource types.
- Target site compromise. Extension redirects to `npmx.dev`; it does not vouch
  for target site's content or security.

Controls:

- No dependencies or third-party executable code in installed extension.
- Review manifest permission diff and build archive contents.
- Require tests plus manual checks in supported browsers.
- Review dependency and lockfile changes before installing them.

## Release verification

Run:

```sh
pnpm validate
unzip -l extensions/npmjs-to-npmx/dist/npmjs-to-npmx.zip
shasum -a 256 extensions/npmjs-to-npmx/dist/npmjs-to-npmx.zip
```

Archive must match runtime file allowlist in
`extensions/npmjs-to-npmx/scripts/build.js`. Any extra file is a release
blocker until explained and reviewed.
