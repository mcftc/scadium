import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegalMeta } from './legal-meta';
import { LEGAL_DOCS } from '@/lib/legal/versions';

/** #48 — every legal page must show a visible version + effective-date line. */
describe('LegalMeta (#48)', () => {
  it('renders the version and a formatted last-updated date for a doc', () => {
    render(<LegalMeta doc="tos" />);
    const line = screen.getByTestId('legal-meta-tos');
    expect(line.textContent).toContain(`Version ${LEGAL_DOCS.tos.version}`);
    expect(line.textContent).toMatch(/Last updated [A-Z][a-z]+ \d{1,2}, \d{4}/);
  });
});
