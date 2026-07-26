# Tessera

Calm Chromium new tab workspace built from nested sections and link tiles.

## Features

- Nested horizontal or vertical groups, limited to 16 levels
- Recursive group collapse controls and weighted tile sizing
- Pointer-based sorting with visible reorder and nesting placeholders
- Automatic favicons, searchable emoji, and uploaded image icons
- Theme-specific favicon contrast backgrounds with adjustable padding and roundedness
- Browser/system, light, dark, Rosé Pine, Vercel, and GitHub themes
- Custom spacing, background colours, images, and 21 pattern choices
- Separate JSON import and export for groups/links and app settings
- Structured Start Tab legacy JSON import
- 22 vibrant Tailwind-inspired accents
- Built-in help, guided onboarding, and a confirmed full reset

No sync, telemetry, analytics, remote code, or network fetches. Tessera stores its data locally and
uses Chromium's local favicon API.

Selected background designs are adapted from [Hero Patterns](https://heropatterns.com/) by Steve Schoger, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Install

```sh
pnpm --filter @browser-extensions/tessera build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select `extensions/structured-start/dist`.
