import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// Flat config (ESLint 9 / Next 16). `next lint` was removed in Next 16; eslint-config-next
// ships a native flat config which we import and spread directly (no FlatCompat bridge).
const eslintConfig = [
  ...nextCoreWebVitals,
  // NOTE (#241): eslint-config-next 16 enables the React-Compiler-era react-hooks
  // rules (set-state-in-effect, refs, purity, immutability, preserve-manual-
  // memoization, use-memo) at `error`. We've adopted them — fixing the genuine
  // issues (derive-during-render, useSyncExternalStore for external stores,
  // hydration via a snapshot helper, …) and leaving a justified
  // `// eslint-disable-next-line` only on the intentional patterns (animation
  // effects driving toward a server result, socket subscribe-in-effect, etc.).
  // They are intentionally left at their eslint-config-next default (`error`)
  // here — no project-wide downgrade.
  {
    // react-three-fiber scenes drive the three.js scene graph imperatively:
    // they use DOM-unknown props (e.g. `position`, `args`), assemble/forward
    // ref "rigs", and mutate object3D transforms inside `useFrame`. That direct
    // scene-graph mutation via refs IS r3f's intended model, so the
    // React-Compiler refs/immutability rules don't apply to these files (same
    // rationale as the long-standing `no-unknown-property` exception). Scoped
    // narrowly to the 3D scene globs — NOT a project-wide relaxation. Placed
    // AFTER the spread config so it wins for these files.
    files: [
      'src/components/three/**/*.tsx',
      'src/**/*-scene.tsx',
      'src/**/*-stage.tsx',
      'src/app/dev/preview-3d/**/*.tsx',
    ],
    rules: {
      'react/no-unknown-property': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
];

export default eslintConfig;
