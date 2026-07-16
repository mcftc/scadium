import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateProfileDto } from './dto/update-profile.dto';

/**
 * Avatar validation (#H-avatar): avatarUrl must be an http(s) URL, a base64
 * RASTER-image data URL, or empty. SVG / non-image data URLs are rejected —
 * they can carry <script>/onload and are a stored-XSS vector if rendered
 * inline; the size cap bounds per-user Postgres blob abuse.
 */
const hasAvatarError = (errors: { property: string }[]) =>
  errors.some((e) => e.property === 'avatarUrl');

describe('UpdateProfileDto.avatarUrl', () => {
  it('accepts raster data URLs, http(s) URLs, and empty (clear)', async () => {
    for (const avatarUrl of [
      'data:image/webp;base64,AAAA',
      'data:image/png;base64,iVBORw0KGgo=',
      'data:image/jpeg;base64,/9j/4AAQ',
      'https://cdn.example.com/a.png',
      '',
    ]) {
      const errors = await validate(plainToInstance(UpdateProfileDto, { avatarUrl }));
      expect(hasAvatarError(errors), `should accept ${avatarUrl.slice(0, 24)}`).toBe(false);
    }
  });

  it('rejects SVG and other script-capable / non-image payloads', async () => {
    for (const avatarUrl of [
      'data:image/svg+xml;base64,PHN2Zw==',
      'data:image/svg+xml,<svg onload=alert(1)>',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
    ]) {
      const errors = await validate(plainToInstance(UpdateProfileDto, { avatarUrl }));
      expect(hasAvatarError(errors), `should reject ${avatarUrl.slice(0, 24)}`).toBe(true);
    }
  });

  it('rejects an oversized data URL (> 120 KB)', async () => {
    const huge = `data:image/png;base64,${'A'.repeat(120_001)}`;
    const errors = await validate(plainToInstance(UpdateProfileDto, { avatarUrl: huge }));
    expect(hasAvatarError(errors)).toBe(true);
  });
});
