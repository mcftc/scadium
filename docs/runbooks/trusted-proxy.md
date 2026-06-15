# Runbook — Trusted proxy & geo header trust (#149)

The geo/VPN guard (`GeoGuard`) decides region eligibility from **request
headers** — the country (`x-vercel-ip-country` / configurable `GEO_COUNTRY_HEADER`)
and the client IP (`x-forwarded-for`). Headers are only as trustworthy as the
proxy that sets them. A caller hitting the origin **directly** (bypassing the
CDN/proxy) can put any value in those headers and self-declare a permitted
country. This runbook describes how the deployment must be configured so that
cannot happen before real money.

## The guarantee the deployment must provide

A single **trusted proxy** (CDN/edge or reverse proxy) sits in front of the API
and, for every request, **strips any inbound copy** of the geo/IP headers before
injecting its own authoritative values. The origin must not be reachable except
through that proxy (network policy / security group / private networking).

Specifically the proxy must:

1. **Delete inbound** `x-forwarded-for`, `x-vercel-ip-country`, `cf-ipcountry`,
   and `x-geo-proxy-secret` from the client request.
2. **Set** the country header from its own geo-IP lookup and append the real
   client IP to `x-forwarded-for`.
3. **Inject** `x-geo-proxy-secret: <GEO_PROXY_SECRET>` (the shared secret only the
   proxy and the API know).

## How the API enforces it

- **`GEO_PROXY_SECRET`** — when set, `GeoGuard` trusts the geo headers **only**
  if the request carries `x-geo-proxy-secret` matching the secret (constant-time
  compare). A missing/mismatched secret ⇒ the request did not come through the
  proxy ⇒ its geo headers are ignored and the region is treated as **unknown**.
- **Fail-closed for real money** — with `REAL_MONEY_ENABLED=true`, an unknown
  region is **blocked (451)**. So a direct-to-origin caller (no valid secret)
  cannot transact. In the play-money demo (`REAL_MONEY_ENABLED` unset) the guard
  fails **open** on an unknown region so it keeps working behind a plain CDN.
- **`trust proxy`** — the app sets Express `trust proxy = 1` so `req.ip` reflects
  the real client as seen by the single trusted proxy (used for the audit hash
  and VPN scoring). If you front the API with **more than one** proxy hop, raise
  this count accordingly so `req.ip` is not a proxy address.
- **IP audit privacy** — raw IPs are never stored; only `sha256(GEO_IP_SALT:ip)`.
  Real money refuses to boot unless `GEO_IP_SALT` is a private value (a public
  default is reversible over the IPv4 space).

## Real-money checklist

- [ ] Origin is **not** publicly reachable; only the trusted proxy can reach it.
- [ ] Proxy strips inbound `x-forwarded-for` / country / `x-geo-proxy-secret`.
- [ ] Proxy injects an authoritative country header + `x-geo-proxy-secret`.
- [ ] `GEO_PROXY_SECRET` set on the API and matches the proxy's injected value.
- [ ] `GEO_IP_SALT` set to a private value.
- [ ] `trust proxy` hop count matches the actual number of proxy hops.
- [ ] If `VPN_DETECTION_ENABLED=true`, `VPN_PROVIDER_API_KEY` is set.

All of the boot-time requirements above are enforced by `assertRealMoneyReady`
(#49/#149) — the API refuses to start if real money is on with any of them
missing. The proxy-side stripping is a deployment responsibility this runbook
documents; it cannot be asserted from inside the app.
