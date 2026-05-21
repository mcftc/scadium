'use client';

import { motion } from 'framer-motion';
import type { Card } from '@scadium/shared';
import { cn } from '@/lib/cn';

const SUIT_SYMBOL: Record<string, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

/**
 * Single playing card with a flip animation when going from face-down to
 * face-up. `placeholder` shows an empty outline for the initial empty seats.
 */
export function CardFace({
  card,
  placeholder,
}: {
  card: Card | null;
  placeholder?: boolean;
}) {
  const isRed = card && (card.suit === 'H' || card.suit === 'D');

  if (placeholder) {
    return (
      <div className="h-24 w-16 rounded-lg border-2 border-dashed border-border/50" />
    );
  }

  if (!card) {
    // Face-down card
    return (
      <div className="h-24 w-16 rounded-lg bg-gradient-to-br from-primary-700 to-primary-900 border border-primary-400/30 shadow-lg flex items-center justify-center">
        <div className="h-16 w-10 rounded border-2 border-primary-400/30 bg-gradient-to-br from-primary-400/10 to-transparent" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ rotateY: 180, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'h-24 w-16 rounded-lg bg-white border border-foreground/20 shadow-lg flex flex-col p-2',
        isRed ? 'text-red-600' : 'text-gray-900',
      )}
    >
      <div className="text-sm font-bold leading-none">{card.rank}</div>
      <div className="text-lg leading-none">{SUIT_SYMBOL[card.suit]}</div>
      <div className="text-2xl mt-auto self-center">{SUIT_SYMBOL[card.suit]}</div>
    </motion.div>
  );
}
