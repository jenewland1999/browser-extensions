# Page Screenshot

Lightweight Manifest V3 Chrome extension for timestamped viewport and full-page screenshots.

## Features

- Capture the visible viewport or stitch the full page in one downward pass.
- Handle fixed and sticky overlays by viewport edge during full-page captures.
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

The popup keeps its compact toolbar size and scrolls its settings area internally when the controls exceed the browser's popup height limit.

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

Full-page capture scrolls down the page once, loading deferred content while stitching viewport captures. To keep infinite feeds from continually loading new content, a full-page capture is capped at 10,000 CSS pixels; longer pages are intentionally truncated at that capture horizon. Fixed and sticky overlays are handled by the edge they are attached to:

- Top overlays are visible in the first tile and hidden from later tiles.
- Bottom overlays are hidden from the first and intermediate tiles and visible in the final tile.
- Left and right overlays are visible only in the first tile, so a fixed-height navigation or rail is not repeated throughout the stitched image.

If a left or right overlay is intended to cover the entire document height, it is currently represented once at the top of the full-page screenshot rather than repeated in every tile.
