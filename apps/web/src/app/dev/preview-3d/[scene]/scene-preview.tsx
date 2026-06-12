'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import { CoinflipPreview } from '../scenes/coinflip-preview';
import { JackpotPreview } from '../scenes/jackpot-preview';
import { TestPreview } from '../scenes/test-preview';

const SCENES: Record<string, { title: string; Component: ComponentType }> = {
  test: { title: 'Foundation test — knot, starfield, confetti, bloom', Component: TestPreview },
  coinflip: {
    title:
      'Coinflip — $SCAD coin tossed by an android, crowd watching, camera dolly-in, late reveal',
    Component: CoinflipPreview,
  },
  jackpot: {
    title:
      'Jackpot — roulette of players: wedges ∝ pot share, marquee bulbs, pointer ticks, winner pop + gold confetti',
    Component: JackpotPreview,
  },
};

export function ScenePreview({ scene }: { scene: string }) {
  const entry = SCENES[scene];
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold text-foreground">3D Preview</h1>
        <nav className="flex gap-3 text-sm">
          {Object.keys(SCENES).map((key) => (
            <Link
              key={key}
              href={`/dev/preview-3d/${key}`}
              className={
                key === scene ? 'text-primary-400 underline' : 'text-foreground-muted hover:text-foreground'
              }
            >
              {key}
            </Link>
          ))}
        </nav>
      </header>
      {entry ? (
        <>
          <p className="mb-4 text-sm text-foreground-muted">{entry.title}</p>
          <entry.Component />
        </>
      ) : (
        <p className="text-foreground-muted">
          Unknown scene “{scene}”. Available: {Object.keys(SCENES).join(', ')}
        </p>
      )}
    </div>
  );
}
