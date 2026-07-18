# Scadium — Design System

Source of truth for the visual language + the UI quality bar. Grounded in the real
tokens (`apps/web/tailwind.config.ts`, `apps/web/src/app/globals.css`), cross-checked
against the `ui-ux-pro-max` design-intelligence skill. The skill's product/style
routing for "crypto casino / gaming" **confirms** this direction — dark, neon-accented,
cyber-display typography — and flags that heavy 3D/hyperrealism gaming styles score
poorly on accessibility, so Scadium stays flat + token-driven.

## Direction

Dark, neon crypto-gaming. Immersive but flat and legible — not skeuomorphic. One
signature display face for the numbers players stare at (multipliers, countdowns),
Inter for everything else. Motion conveys state (bust, cashout, win), never decoration.

## Color tokens (semantic — never raw hex in components)

| Token | Value | Use |
|---|---|---|
| `background` | `#0B0A14` | app canvas |
| `surface` / `surface-elevated` | `#13111F` / `#1C1930` | cards / raised controls |
| `border` | `#2A2640` | dividers, control outlines |
| `foreground` | `#F5F3FF` | primary text (~18:1 on bg) |
| `foreground-muted` | `#B5B0C7` | secondary text (clears ≥3:1 on surface) |
| `primary` (gradient `#EE86FF → #6F5FCC`) | magenta→indigo | brand, focus ring, CTAs |
| `success` / `danger` | `#22C55E` / `#EF4444` | win/profit · loss/error |

Win/loss is **never color-only** — pair it with a glyph or text (multiplier vs `—`,
a Trophy icon, a `+`/`−` prefix) so it reads for color-blind users.

## Typography

- **Body/UI:** Inter (`--font-geist-sans`).
- **Display:** Chakra Petch (`--font-display`, tabular figures) — the crash multiplier,
  countdowns, race pool, RTP figures. Keeps the big changing numbers from jittering.
- Base 16px, line-height ~1.5; body text never below 12px.

## Motion

- Micro-interactions 150–300ms; press feedback is color/brightness + a 0.97 scale
  (no layout shift). Loading uses a spinner (`animate-spin`) — it conveys status.
- **`prefers-reduced-motion` is honored globally** (`globals.css`): transitions/transforms
  drop to instant, decorative loops (`animate-pulse`/`ping`, shimmer, glow) stop;
  `animate-spin` is intentionally kept.

## The quality bar (pre-delivery checklist — from the skill, scoped to web)

Before shipping any UI, verify:

- [ ] **Focus:** every interactive element has a visible `:focus-visible` ring (global
  rule exists — don't `outline-none` without a replacement).
- [ ] **Labels:** inputs are programmatically associated (`<label htmlFor>` / `useId`),
  not placeholder-only; icon-only buttons have `aria-label`.
- [ ] **Contrast:** primary text ≥4.5:1, secondary ≥3:1 (dark mode checked, not inferred).
- [ ] **Color isn't the only signal** (win/loss/status carry a glyph or text too).
- [ ] **Reduced motion** respected; **touch targets** ≥44px on the mobile breakpoints.
- [ ] **Semantic tokens** only — no ad-hoc per-component hex.
- [ ] Icons from one family (Lucide), consistent stroke/size; **no emoji as icons**.
- [ ] Responsive at 375 / 768 / 1024 / 1440; no horizontal scroll; viewport zoom allowed.

_Query the skill for specifics: `search.py "<need>" --domain ux|color|typography|gsap` or
`--design-system` for a fresh recommendation._
