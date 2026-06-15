import { LEGAL_DOCS, formatLegalDate, type LegalDocKey } from '@/lib/legal/versions';

/**
 * The 'Version X · Last updated …' line shown at the top of each legal page so
 * users can see exactly which version they are reading (#48).
 */
export function LegalMeta({ doc }: { doc: LegalDocKey }) {
  const meta = LEGAL_DOCS[doc];
  return (
    <p className="text-xs text-foreground-muted" data-testid={`legal-meta-${doc}`}>
      Version {meta.version} · Last updated {formatLegalDate(meta.effectiveDate)}
    </p>
  );
}
