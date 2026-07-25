# Page Screenshot

Lightweight Manifest V3 Chrome extension for timestamped viewport and full-page screenshots.

## Features

- Capture the visible viewport or stitch the full page in one downward pass.
- Keep fixed and sticky overlays only at the top of full-page screenshots.
- Save as lossless PNG or adjustable-quality JPEG and WebP.
- Save directly to `Downloads` or choose a location for each capture.
- Customize filenames with domain, capture type, date, and time tokens.
- Trigger either capture type with configurable browser shortcuts.

## Install unpacked

1. Run `pnpm --filter @browser-extensions/page-screenshot build` from repository root.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose `extensions/page-screenshot/dist`.

## Settings

Screenshots save automatically to `Downloads`. Enable **Choose each time** to select another location for each capture. Chrome does not allow extensions to silently save outside the browser's Downloads directory.

Choose PNG, JPEG, or WebP in the popup. JPEG and WebP support adjustable quality.

Customize filenames with these tokens:

| Token      | Example      |
| ---------- | ------------ |
| `%domain%` | `elanco.com` |
| `%type%`   | `full-page`  |
| `%date%`   | `2026-07-25` |
| `%time%`   | `09-08-07`   |

The default is `%domain%_%type%_%date%_%time%`. The selected file extension is appended automatically, and characters that are unsafe in filenames are sanitized.

## Shortcuts

Default shortcuts are `Command+Shift+1` / `Ctrl+Shift+1` for the viewport and `Command+Shift+2` / `Ctrl+Shift+2` for the full page. Configure them at `chrome://extensions/shortcuts`.

## Full-page capture

Full-page capture scrolls down the page once, loading deferred content while stitching viewport captures. Fixed and sticky overlays are included only at the top of the screenshot.
