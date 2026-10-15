# UI design guide for agents

Use this guide when adding or restyling pages, sections, and components. Match the existing system before inventing another one; keep changes scoped and verify the real page at both desktop and compact sizes.

## Visual language

- **Typeface:** use the system UI sans stack from `src/assets/tailwind.css`. No bundled display font is part of the design system. Use monospace only for code, addresses, and machine-like values.
- **Palette:** dark navy surfaces, cool blue borders and links, lime brand accent, pale foreground, muted blue-gray supporting text. Reuse `--surface`, `--edge`, `--accent`, `--brand-accent`, `--muted`, and `--link`; do not introduce near-duplicate colors.
- **Shape and hierarchy:** restrained rounded corners, thin borders, clear section headings, generous whitespace on desktop, compact controls and readable line lengths. Use existing panels/cards and shared components when they fit.
- **Type scale:** desktop can be expressive: large headings, prominent stats, and visible section spacing. Keep body copy comfortably readable. Do not scale every label with the heading.

## Responsive sizing

- Tailwind v4 and `fluid-tailwindcss` are enabled in `src/assets/tailwind.css`. Use existing `fl-*` utilities where they fit; use CSS `clamp(min, fluid, max)` for bespoke fluid values. Bound every fluid size and test both ends—never let viewport units make text or spacing grow without limit.
- Prefer `em` for component-internal spacing and type-relative dimensions; use `rem` for page-level rhythm. Use `minmax(0, 1fr)`, `min-width: 0`, wrapping, and `overflow-wrap` to prevent long content from forcing horizontal overflow.
- Let grids adapt with `auto-fit`/`auto-fill` and a sensible minimum card width. Prefer natural wrapping over breakpoint-by-breakpoint column counts unless a real layout transition requires one.
- Preserve visible keyboard focus, adequate contrast, and touch targets (normally at least 44px for interactive controls). Respect reduced-motion preferences for nonessential animation.

## Steam/Valve MOTD: compact first

MOTD is a constrained embedded browser, not a shrunken desktop page. Keep the small/short-window experience dense, legible, and usable; prioritize the primary content and chat, avoid decorative padding, and do not assume hover, abundant height, or modern browser chrome.

- Preserve the existing `body.is-game` / `.motd-home` layout and its shared `--motd-text` / `--motd-space` scale in `src/assets/tailwind.css`. Reuse these tokens for new MOTD content instead of adding independent fixed sizing.
- The large-MOTD enhancement is deliberately gated at `min-width: 1000px` **and** `min-height: 600px`. Keep short/narrow windows on the compact layout; do not move desktop-scale typography or spacing outside that gate.
- Keep content in the scrollable content pane; avoid making the whole embedded viewport taller than available space. Allow cards, navigation, and controls to wrap. Keep interactive targets usable even when the type is compact.
- MOTD guide cards use an auto-fitting grid with a compact `9em` minimum. Preserve four-across when the container permits and graceful wrapping when it does not; do not hard-code four columns at every width.
- Keep game-specific selectors scoped to `.is-game` (and `.motd-home` when homepage-only). Do not let MOTD overrides leak into normal website pages or vice versa.

## Before calling UI work done

1. Check the shared styles and nearest page/component for an existing pattern; extend it rather than duplicating tokens or primitives.
2. Verify a normal desktop view, a narrow view, and—if the change can appear in-game—a short/narrow MOTD view plus a large MOTD view. Check wrapping, overflow, focus, and touch controls.
3. Update relevant layout/component tests and run them. For merge-ready changes, run `pnpm run check` as described in the README.
4. If a change establishes a new reusable visual rule or changes one here, update this guide in the same change.
