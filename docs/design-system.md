# Scadium — Design System ("Aurum")

Source of truth for the visual language + the UI quality bar. Grounded in the real
tokens (`apps/web/tailwind.config.ts`, `apps/web/src/app/globals.css`), cross-checked
against the `ui-ux-pro-max` design-intelligence skill.

**Why this exists / what changed.** Scadium's first look (deep purple canvas +
magenta→indigo neon) read as a clone of solpump.io — the reference we modelled the
_product_ on, not the _brand_. This system replaces that with **Aurum**: a warm,
premium-arcade identity built on **jackpot gold + electric teal on deep obsidian**.
It's deliberately unlike the cold purple/violet that dominates crypto-casino UIs, so
Scadium looks like itself. The change is token-driven: components consume semantic
tokens (`primary`, `surface`, `accent`, `success`…), so the palette propagates without
per-component rework.

## Direction

Warm, premium-arcade crypto-gaming. Gold is the hero — it's the colour of a payout,
a jackpot, a coin — so it carries the brand, CTAs and the numbers players stare at.
Electric teal is the cool counterpoint: links, live indicators, secondary highlights.
The canvas is a near-black obsidian with a faint gold glow up top and a teal glow at
the base — an "aurora casino" backdrop that's immersive but stays flat and legible
(never skeuomorphic). Motion conveys state (bust, cashout, win), never decoration.

## Color tokens (semantic — never raw hex in components)

| Token | Value | Use |
|---|---|---|
| `background` | `#0A0B0F` | app canvas (deep obsidian) |
| `surface` / `surface-elevated` | `#13151C` / `#1C1F2B` | cards / raised controls |
| `border` | `#2A2E3C` | dividers, control outlines |
| `foreground` | `#F5F7FA` | primary text (~17:1 on bg) |
| `foreground-muted` | `#9AA1B0` | secondary text (clears ≥4.5:1 on surface) |
| `primary` (gold, ramp 50→900) | DEFAULT `#FFBE3D` | **brand, focus ring, primary CTAs, hero numbers** |
| `accent` (teal) | DEFAULT `#2DD4BF` | links, live/online dots, secondary highlights |
| `success` / `danger` | `#22C55E` / `#EF4444` | win/profit · loss/error |
| `warning` | `#F59E0B` | caution states |

**Signature gradient** — the "jackpot glow": `linear-gradient(135deg, #FFCE5E → #FF7A45)`
(gold → warm coral). Exposed as `bg-gradient-primary` and the `.text-gradient` utility;
used on the wordmark, hero headings and marquee CTAs. **Glow shadow** (`shadow-glow`)
and all hover glows use gold `rgba(255,190,61,·)`.

Win/loss is **never colour-only** — pair it with a glyph or text (a multiplier vs `—`,
a Trophy icon, a `+`/`−` prefix) so it reads for colour-blind users. Note gold (brand)
and green (`success`) are kept visually distinct so "gold ≠ win"; a win is always green
+ a glyph, gold is reserved for brand/CTA/value.

## Typography

- **Body/UI:** Inter (`--font-geist-sans`).
- **Display:** Chakra Petch (`--font-display`, tabular figures) — the crash multiplier,
  countdowns, race pool, RTP figures. Tabular numerals keep the big changing numbers
  from jittering.
- Base 16px, line-height ~1.5; body text never below 12px.

## Motion

- Micro-interactions 150–300ms; press feedback is colour/brightness + a 0.97 scale
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
- [ ] **Colour isn't the only signal** (win/loss/status carry a glyph or text too).
- [ ] **Reduced motion** respected; **touch targets** ≥44px on the mobile breakpoints.
- [ ] **Semantic tokens** only — no ad-hoc per-component hex (game-art SVGs are the one
  exception, and they draw from the palette values below).
- [ ] Icons from one family (Lucide), consistent stroke/size; **no emoji as icons**.
- [ ] Responsive at 375 / 768 / 1024 / 1440; no horizontal scroll; viewport zoom allowed.
- [ ] Overlays/modals **portal to `document.body`** so a `fixed` overlay can't be trapped
  by an ancestor stacking context (this was the airdrop "layout disappears" bug).

---

## Master design prompt (reusable)

Paste this to any design/AI tool to generate or extend a Scadium surface on-brand:

> **Design a screen for "Scadium", a non-custodial, provably-fair Solana casino /
> play-to-earn platform. Identity is "Aurum" — warm premium-arcade, NOT the cold
> purple/violet crypto-casino look.**
>
> **Palette:** deep obsidian canvas `#0A0B0F`; cards `#13151C` / raised `#1C1F2B`;
> hairline borders `#2A2E3C`; text `#F5F7FA` / muted `#9AA1B0`. Hero colour is
> **jackpot gold `#FFBE3D`** (brand, primary CTAs, the big numbers). Cool accent is
> **electric teal `#2DD4BF`** (links, live/online dots, highlights). Wins are green
> `#22C55E`, losses red `#EF4444`, always paired with an icon or +/− sign — never colour
> alone. Signature gradient is a warm "jackpot glow" gold→coral `#FFCE5E → #FF7A45` on the
> wordmark and marquee CTAs. Backdrop carries a faint gold radial glow at the top and a
> teal glow at the bottom (aurora-casino feel). Gold glow shadows on hover.
>
> **Type:** Inter for UI/body; Chakra Petch (tabular figures) for the display numbers
> (multipliers, countdowns, pools). Base 16px, generous line-height.
>
> **Feel:** immersive but flat and legible — no skeuomorphism, no drop-shadowed felt.
> Delightful, high-energy, premium. Motion only conveys state (bet placed, cashout, bust,
> win) and respects `prefers-reduced-motion`.
>
> **Bar:** WCAG-AA contrast in dark mode, visible focus rings, labelled inputs, Lucide
> icons (no emoji as icons), ≥44px touch targets, responsive 375→1440 with no horizontal
> scroll, overlays portalled to the body.

## Game-art palette values (for bespoke SVG/canvas scenes only)

Non-token surfaces (the crash rocket/curve, wheel, plinko, blackjack table, 3D card
scenes) draw from these — keep them in sync with the tokens above:

- Gold ramp: `#FFCE5E` `#FFBE3D` `#F5A623` `#DB8A12` `#B26B0C` `#8A5209` `#5C3606`
- Coral / warm: `#FF7A45` `#FF6A00` · Rose: `#F43F5E`
- Teal / cyan accents: `#5EEAD4` `#2DD4BF` `#22D3EE` `#34D6EE` (already used on the rocket)
- Emerald win: `#34D399` `#22C55E` · Sky/blue variety: `#38BDF8` `#60A5FA`

_Query the skill for specifics: `search.py "<need>" --domain ux|color|typography|gsap` or
`--design-system` for a fresh recommendation._
