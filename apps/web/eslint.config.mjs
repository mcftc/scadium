import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

// Flat config (ESLint 9 / Next 16). `next lint` was removed in Next 16; eslint-config-next
// ships a native flat config which we import and spread directly (no FlatCompat bridge).
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    // r3f/three scenes use DOM-unknown props (e.g. `position`, `args`) by design.
    files: [
      'src/components/three/**/*.tsx',
      'src/**/*-scene.tsx',
      'src/**/*-stage.tsx',
      'src/app/dev/preview-3d/**/*.tsx',
    ],
    rules: {
      'react/no-unknown-property': 'off',
    },
  },
  {
    // eslint-config-next 16 newly enables the React-Compiler-era react-hooks rules
    // (set-state-in-effect, refs, purity, immutability, …). They flag many existing,
    // intentional patterns. Keep them as WARNINGS for the framework upgrade (no
    // behaviour change) rather than silently adopting a stricter lint gate; adopting
    // / fixing them is a deliberate follow-up.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
];

export default eslintConfig;
