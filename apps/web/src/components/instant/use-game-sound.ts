'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLocalStorageValue, writeLocalStorageValue } from '@/hooks/use-local-storage-value';

/**
 * Tiny Web-Audio sound layer for every game — NO audio assets. A single
 * lazily-created AudioContext drives short oscillator blips (peg/segment ticks),
 * a win "zap" sweep, a crash explosion and a blackjack card-draw rustle. ON by
 * default (opt-out, persisted in localStorage). The AudioContext is only created
 * on the first cue — which always follows a user gesture (place bet, take a seat)
 * — so the browser autoplay policy is satisfied and nothing plays on cold load.
 */
const STORAGE_KEY = 'scadium:instant:sound';

export function useGameSound() {
  // Persisted preference read reactively (null on SSR + first paint → no
  // hydration drift). Default ON: only an explicit '0' (the user muting) silences
  // it, so games have sound out of the box without a setState-in-effect.
  const enabled = useLocalStorageValue(STORAGE_KEY) !== '0';
  const ctxRef = useRef<AudioContext | null>(null);

  const toggle = useCallback(() => {
    writeLocalStorageValue(STORAGE_KEY, enabled ? '0' : '1');
  }, [enabled]);

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

  /**
   * One short note at `freq` starting `atMs` from now — the building block for
   * the composed cues below (bet clink, cash-out jingle).
   */
  const note = useCallback(
    (
      freq: number,
      atMs: number,
      durationMs: number,
      gain: number,
      type: OscillatorType = 'triangle',
    ) => {
      const ac = ctx();
      if (!ac) return;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      const start = ac.currentTime + atMs / 1000;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(gain, start + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
      osc.connect(g).connect(ac.destination);
      osc.start(start);
      osc.stop(start + durationMs / 1000 + 0.02);
    },
    [ctx],
  );

  /** Coin/chip "clink" on placing a bet — two quick bright metallic blips. */
  const bet = useCallback(() => {
    note(1180, 0, 45, 0.05, 'square');
    note(1560, 35, 55, 0.04, 'square');
  }, [note]);

  /**
   * Bright bell "kling" on cash-out / parachute exit — a metallic ding (two
   * sine partials, quick decay). Replaces the old coin arpeggio.
   */
  const cashout = useCallback(() => {
    const ac = ctx();
    if (!ac) return;
    const now = ac.currentTime;
    ([
      [2100, 0.06],
      [3160, 0.03],
    ] as const).forEach(([freq, peak]) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      osc.connect(g).connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.55);
    });
  }, [ctx]);

  /** Descending low thud on a loss / bust. */
  const lose = useCallback(() => {
    const ac = ctx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sawtooth';
    const now = ac.currentTime;
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.32);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.07, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
    osc.connect(g).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.42);
  }, [ctx]);

  /**
   * Short burst of white noise — the raw material for the crash explosion and the
   * blackjack card "rustle". Built once per call (cheap; GC'd after it stops).
   */
  const noiseBurst = useCallback(
    (ac: AudioContext, durationMs: number): AudioBufferSourceNode => {
      const frames = Math.max(1, Math.floor((ac.sampleRate * durationMs) / 1000));
      const buffer = ac.createBuffer(1, frames, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      return src;
    },
    [],
  );

  /**
   * Crash bust — a metallic "iron snap": a bright noise crack (the break)
   * layered with inharmonic metal partials that ring and bend down briefly
   * (demir kırılması). Deliberately NO low boom sweep (that read as a "fart").
   */
  const explosion = useCallback(() => {
    const ac = ctx();
    if (!ac) return;
    const now = ac.currentTime;

    // Crack: bright high-passed noise transient — the snap.
    const noise = noiseBurst(ac, 130);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.2, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    noise.connect(hp).connect(ng).connect(ac.destination);
    noise.start(now);
    noise.stop(now + 0.14);

    // Metallic ring: inharmonic partials (clang), each bending down a touch as
    // the metal "gives", with staggered fast decays.
    const base = 330;
    [1, 2.76, 5.4, 8.93].forEach((ratio, i) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'triangle';
      const f = base * ratio;
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.78, now + 0.3);
      const peak = 0.09 / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32 + i * 0.05);
      osc.connect(g).connect(ac.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    });
  }, [ctx, noiseBurst]);

  /** Card deal — a brief band-passed noise "snap/rustle" (kart hışırtısı). */
  const card = useCallback(() => {
    const ac = ctx();
    if (!ac) return;
    const now = ac.currentTime;
    const noise = noiseBurst(ac, 70);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.06, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    noise.connect(bp).connect(g).connect(ac.destination);
    noise.start(now);
    noise.stop(now + 0.08);
  }, [ctx, noiseBurst]);

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

  return { enabled, toggle, tick, win, bet, cashout, lose, explosion, card };
}

export type GameSound = ReturnType<typeof useGameSound>;
