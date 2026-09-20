import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext adapter config for deploying apps/web to Cloudflare Workers.
 *
 * Defaults are deliberate (YAGNI): no incremental cache, no tag cache and no
 * queue are configured, because this app has no ISR/`revalidate` surface today —
 * pages are either static or rendered per-request against the API. Add an R2 or
 * KV incremental cache here the first time a page actually needs one.
 */
export default defineCloudflareConfig();
