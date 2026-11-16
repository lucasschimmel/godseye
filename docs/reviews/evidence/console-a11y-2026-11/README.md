# Console accessibility and tablet evidence (gap A15), 2026-11-16

Scope: the owner console navigation pages (overview, projects, databases, CI / CD, jobs, usage,
observability, operations, infrastructure, Hermes CORE, owner access, secrets and services),
rendered in local mode behind a virtual-authenticator passkey session.

## How to reproduce

```
bunx playwright test --config playwright.a11y.config.ts
```

The config starts one isolated instance on ports 4720 (console) and 4721 (API). Set
`GODSEYE_A11Y_SCREENSHOTS=<dir>` to also write full-page screenshots. The first start can take a
few minutes while the toolchain compiles; the web server timeout allows for it.

## What passes (53 of 53 tests after the fixes)

- axe-core (`@axe-core/playwright` 4.14.0, tags wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) reports
  zero violations on all 12 pages at 1280, 1024, 768 and 375 px wide (48 checks).
- No horizontal page overflow at any of those widths.
- Skip link is the first tab stop, becomes visible and moves focus to `main#main-content`.
- Exactly one banner, one main, one contentinfo, one labelled main navigation and one h1.
- A client-side navigation moves focus to the main landmark and announces the page.
- Focus ring is visible on the first 14 tab stops of the overview.
- Under `prefers-reduced-motion: reduce` no element keeps a transition or animation.
- Vitest: `tests/console-route-announcement.test.ts` (focus helper, navigation detection,
  announcement and title text, live-region markup).

## What was wrong before (baseline run, same tests)

- 48 of 48 page checks failed. color-contrast: secondary text `#68787e` was 3.99:1 on the page canvas and
  4.29:1 on subtle surfaces; the accent `#147b80` was 4.39:1 on its tinted surface.
- label-content-name-mismatch: the brand link `aria-label` did not contain its visible text.
- scrollable-region-focusable: the infrastructure headroom tables scroll sideways but were not
  keyboard reachable.
- target-size: the passkey name field on the owner access page was narrower than 24 px when squeezed.
- Tablet: the 210 px side rail left about 558 px of content at 768 px and clipped the data tables.
- Route changes left focus on the previous link and gave screen readers no announcement.
- Reduced motion only covered a few selectors, not every transition.

## What was fixed

- `theme.css`: `--text-secondary` is now `#5b6b71` and `--accent-ink` `#126f73` (both at least 4.5:1
  on every surface that uses them).
- `responsive-tablet.css`: tablet breakpoint at 1024 px; the rail becomes a wrapping top bar so
  content uses the full width.
- `accessibility.css`: global reduced-motion override, forced-colors focus ring, passkey field size.
- `shell.tsx`, `route-announcer.tsx`, `route-announcement.ts`: brand link name, focus move,
  polite live region and per-page tab title on navigation.
- `infra-headroom-panel.tsx`: scrollable tables are labelled, focusable regions.

## What remains (not verified)

- Pages were audited in their empty local-mode state. Panels that only render with data (populated
  project tables, delivery history rows, open dialogs, error and pending boundaries) were not
  exercised by axe.
- axe finds roughly a third of WCAG issues; no manual screen-reader pass (NVDA, VoiceOver) and no
  200 percent zoom or text-spacing check was done. Only Chromium was tested.
- Colour contrast of dark-theme-only or hover and disabled states is not covered by axe.
- Document title is set from the client after navigation; the server-rendered title stays generic.
- `/projects/new` and project detail pages were not in the audited set.

## Screenshots

`before/` and `after/` hold full-page captures for overview (1280, 768, 375), infrastructure
(1024, 768, 375) and security (768). The full set of 48 per run was trimmed to keep the repository small.
