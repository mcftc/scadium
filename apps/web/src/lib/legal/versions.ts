import { LEGAL_VERSION } from '@scadium/shared';

export { LEGAL_VERSION };

export interface LegalDocMeta {
  version: string;
  /** ISO date (YYYY-MM-DD). */
  effectiveDate: string;
}

/**
 * Per-document version + effective date, the single source of truth for the
 * 'Version X · Last updated …' line on each legal page (#48). Bump a doc's
 * version here when its copy changes; bump `LEGAL_VERSION` (in @scadium/shared)
 * to re-trigger the acceptance gate for everyone.
 */
export const LEGAL_DOCS = {
  tos: { version: '1.0', effectiveDate: '2026-06-15' },
  aml: { version: '1.0', effectiveDate: '2026-06-15' },
  privacy: { version: '1.0', effectiveDate: '2026-06-15' },
  cookie: { version: '1.0', effectiveDate: '2026-06-15' },
} satisfies Record<string, LegalDocMeta>;

export type LegalDocKey = keyof typeof LEGAL_DOCS;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Deterministic 'Month D, YYYY' (no locale → no hydration mismatch). */
export function formatLegalDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}, ${y}`;
}
