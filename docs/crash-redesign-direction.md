# Crash Game — Visual Direction (inspired by solpump, not a copy)

_Reference: solpump.io crash (rocket on a grid, big centered payout, right-side multiplier ruler, falling airdrop crates). Goal: match/exceed its polish with Scadium's **own** identity._

## Where Scadium's crash already stands

The crash view is **not** generic — `crash-curve.tsx` is a 697-line custom scene: starfield, a 3-D perspective receding grid, an SVG rocket riding a neon curve with a flickering thruster, a rescaling multiplier ruler, cash-out parachute markers, and a multi-layer bust explosion. Layout already matches solpump (game center, bet panel + live players right, chat in the global left rail). So this is a **polish + identity** job, not a rebuild.

## The one thing that made it feel generic → fixed

The whole app rendered in **Inter** (mislabeled `--font-geist-sans`) — the default "AI-slop" sans. The crash hero multiplier is the most-looked-at number on the site; in Inter it reads like every other dApp. **Shipped now:** a signature display face — **Chakra Petch** (angular, techy, **tabular** figures) — as `font-display`, applied to the crash hero multiplier, the countdown, and the history chips. Tabular numerals also stop the giant multiplier from *jittering* horizontally as digits change during the climb (a real flaw solpump avoids). This single change gives Scadium a distinct crypto-gaming identity vs solpump's plain bold sans, and is reversible in one line.

## Distinctive direction (so it's "inspired," not a clone)

Don't copy the rocket-on-grid. Lean into Scadium's **Proof-of-Play / mining** identity — the differentiator solpump doesn't have:

1. **Motif — "ascent," not a rocket.** Replace/augment the literal rocket with a **cometary $SCAD ore trail** or an abstract ascending spark that leaves a crystalline neon wake in the pink→violet brand gradient (`#EE86FF`→`#6F5FCC`), reserving cyan (`#22d3ee`) purely for *your* live-profit state. The wake should crystallize into faceted shards as the multiplier climbs (ties to "mining"), so higher multipliers literally look more valuable.
2. **Hero number treatment.** Chakra-Petch multiplier with a **gradient-fill that shifts with risk** (calm violet < 2×, electric cyan 2–8×, hot magenta > 8×) + a subtle glow bloom. Keep the `×` a lighter weight/smaller (shipped) so the number dominates.
3. **The ruler = a "vein."** solpump's right ruler is plain ticks. Make Scadium's a **mineral vein/depth gauge** — tick density and a faint ore-glow that intensifies near the current multiplier — reinforcing the mining theme.
4. **Bust = "shatter," not just explosion.** On bust, the crystallized wake **shatters** into falling shards that dissolve, rather than a generic fireball — a memorable, ownable moment.
5. **Live-profit chip → "extraction."** Frame the green cash-out as *"extracted +X SOL"* micro-language, with a brief particle burst pulled from the wake — small copy/motion touches that make the moment feel like mining, not gambling.
6. **Airdrop crates.** solpump drops parachute crates; Scadium already has cash-out parachutes. Differentiate by making them **$SCAD ore crates** with the crystalline facet language, only during the hourly-airdrop window, tying the visual to the real Proof-of-Play airdrop mechanic.

## How to execute the pixel polish (needs live preview)

Visual quality can't be dialed in blind. The repo is set up for exactly this — the `r3f-scene-builder` + `visual-qa` agents build a scene on a `/dev/preview-3d/<scene>` route and capture timed screenshots for approval. Recommended loop:
1. `pnpm dev` (web) against a running API, or the visual-qa flow, to see the current crash live.
2. Iterate the wake/hero/ruler/bust per the direction above, screenshot each pass, approve, then integrate into the live `/crash` page.

The font identity is the safe, high-leverage first step landed now; the motif/motion work above is the follow-up done with sight.
