'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tiny Web-Audio sound layer for the instant games — NO audio assets. A single
 * lazily-created AudioContext drives short oscillator blips (peg/segment ticks)
 * and a win "zap" sweep. Muted by default; the toggle persists in localStorage.
 * Respects the OS "reduce sound"/reduced-motion intent by never auto-playing.
 */
const STORAGE_KEY = 'scadium:instant:sound';

export function useGameSound() {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  // Restore persisted preference on mount (client-only to avoid hydration drift).
  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Browsers cap AudioContexts per origin (~6); close ours on unmount so
  // hopping between the four game pages doesn't leak one context each.
  useEffect(
    () => () => {
      ctxRef.current?.close();
      ctxRef.current = null;
    },
    [],
  );

  const ctx = useCallback((): AudioContext | null => {
    if (!enabled) return null;
    if (typeof window === 'undefined') return null;
    // A closed context can't be reused — drop it so we lazily make a fresh one.
    if (ctxRef.current?.state === 'closed') ctxRef.current = null;
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctxRef.current = new Ctor();
    }
    if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
    return ctxRef.current;
  }, [enabled]);

  /** A short percussive blip — used for peg bounces and wheel ratchet ticks. */
  const tick = useCallback(
    (freq = 660, durationMs = 35, gain = 0.05) => {
      const ac = ctx();
      if (!ac) return;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const now = ac.currentTime;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(gain, now + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
      osc.connect(g).connect(ac.destination);
      osc.start(now);
      osc.stop(now + durationMs / 1000 + 0.02);
    },
    [ctx],
  );

  /** Rising sweep on a win, scaled a touch by multiplier for "bigger = brighter". */
  const win = useCallback(
    (multiplier = 1) => {
      const ac = ctx();
      if (!ac) return;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sawtooth';
      const now = ac.currentTime;
      const top = 440 + Math.min(880, multiplier * 90);
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(top, now + 0.22);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.08, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      osc.connect(g).connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.42);
    },
    [ctx],
  );

  return { enabled, toggle, tick, win };
}

export type GameSound = ReturnType<typeof useGameSound>;
