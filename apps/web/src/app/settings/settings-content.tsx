'use client';

import { useEffect, useState } from 'react';
import { Mail, Globe, Send, MessageCircle, Check, Wallet, Star } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { UsernameForm } from '@/components/profile/username-form';
import {
  useMe,
  useUpdateProfile,
  useUpdateConnection,
  type SocialProvider,
} from '@/hooks/use-me';
import {
  useWallets,
  useLinkWallet,
  useSetPrimaryWallet,
  useUnlinkWallet,
} from '@/hooks/use-wallets';
import { ApiError } from '@/lib/api-client';
import { shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PhotoSection } from './photo-section';

const PROVIDERS: {
  key: SocialProvider;
  label: string;
  icon: typeof Globe;
  placeholder: string;
}[] = [
  { key: 'google', label: 'Google', icon: Globe, placeholder: 'you@gmail.com' },
  { key: 'telegram', label: 'Telegram', icon: Send, placeholder: '@handle' },
  { key: 'discord', label: 'Discord', icon: MessageCircle, placeholder: 'name#0000' },
];

export function SettingsContent() {
  const { data: me } = useMe();
  const update = useUpdateProfile();

  const [email, setEmail] = useState('');
  useEffect(() => {
    if (me) setEmail(me.email ?? '');
  }, [me]);

  if (!me) return null;
  const emailDirty = email.trim() !== (me.email ?? '');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <PhotoSection />

          <div className="border-t border-border pt-6">
            <label className="text-xs uppercase tracking-wider text-foreground-muted">
              Username
            </label>
            <div className="mt-2">
              <UsernameForm />
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <label className="text-xs uppercase tracking-wider text-foreground-muted">Email</label>
            <p className="text-xs text-foreground-muted mt-1 mb-2">
              Used for win alerts and account recovery. We never share it.
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-muted" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-border bg-surface-elevated pl-9 pr-3 h-11 text-sm focus:outline-none focus:border-primary-400"
                />
              </div>
              <Button
                disabled={!emailDirty || update.isPending}
                onClick={() => update.mutate({ email: email.trim() })}
              >
                Save
              </Button>
            </div>
            {update.isError && (
              <p className="text-xs text-danger mt-2">Enter a valid email address.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <WalletsCard />

      <Card>
        <CardHeader>
          <CardTitle>Connections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-foreground-muted">
            Link social accounts for support and recovery. Full OAuth sign-in lands with provider
            keys; linking here records the handle for now.
          </p>
          {PROVIDERS.map((p) => (
            <ConnectionRow
              key={p.key}
              provider={p.key}
              label={p.label}
              icon={p.icon}
              placeholder={p.placeholder}
              handle={me.connections[p.key]}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <ToggleRow
            label="Big win alerts"
            description="Email me when I hit a large multiplier or jackpot."
            on={me.prefs.emailWins}
            disabled={update.isPending}
            onChange={(v) => update.mutate({ notifyEmailWins: v })}
          />
          <ToggleRow
            label="Product updates"
            description="Occasional news about new games and features."
            on={me.prefs.marketing}
            disabled={update.isPending}
            onChange={(v) => update.mutate({ notifyMarketing: v })}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function WalletsCard() {
  const { data } = useWallets();
  const link = useLinkWallet();
  const setPrimary = useSetPrimaryWallet();
  const unlink = useUnlinkWallet();
  const wallets = data?.wallets ?? [];
  const busy = link.isPending || setPrimary.isPending || unlink.isPending;
  const linkErr =
    link.error instanceof ApiError
      ? link.error.message
      : link.error
        ? (link.error as Error).message
        : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-foreground-muted">
          Link multiple wallets to one account — sign in with any of them. The primary wallet is
          shown across the app.
        </p>
        {wallets.map((w) => (
          <div
            key={w.address}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface-elevated/40 px-4 py-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-400/10 border border-primary-400/20">
              <Wallet className="h-4 w-4 text-primary-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm truncate">{shortAddress(w.address)}</div>
              {w.primary && (
                <div className="text-[10px] uppercase tracking-wider text-amber-400 inline-flex items-center gap-1">
                  <Star className="h-3 w-3 fill-amber-400" /> Primary
                </div>
              )}
            </div>
            {!w.primary && (
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setPrimary.mutate(w.address)}
                >
                  Make primary
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => unlink.mutate(w.address)}
                >
                  Unlink
                </Button>
              </div>
            )}
          </div>
        ))}
        <div className="pt-1">
          <Button variant="secondary" disabled={busy} onClick={() => link.mutate()}>
            <Wallet className="h-4 w-4" />
            {link.isPending ? 'Signing…' : 'Link this wallet'}
          </Button>
          {linkErr && <p className="text-xs text-danger mt-2">{linkErr}</p>}
          <p className="text-[11px] text-foreground-muted mt-2">
            Connect the wallet you want to add, then sign to prove ownership.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ConnectionRow({
  provider,
  label,
  icon: Icon,
  placeholder,
  handle,
}: {
  provider: SocialProvider;
  label: string;
  icon: typeof Globe;
  placeholder: string;
  handle: string | null;
}) {
  const conn = useUpdateConnection();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const connected = !!handle;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-elevated/40 px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-400/10 border border-primary-400/20">
        <Icon className="h-4 w-4 text-primary-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-foreground-muted truncate">
          {connected ? (
            <span className="text-success inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> {handle}
            </span>
          ) : (
            'Not connected'
          )}
        </div>
      </div>

      {connected ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={conn.isPending}
          onClick={() => conn.mutate({ provider, account: null })}
        >
          Disconnect
        </Button>
      ) : editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={placeholder}
            className="w-36 rounded-lg border border-border bg-surface px-2 h-9 text-sm focus:outline-none focus:border-primary-400"
          />
          <Button
            size="sm"
            disabled={!val.trim() || conn.isPending}
            onClick={() =>
              conn.mutate(
                { provider, account: val.trim() },
                { onSuccess: () => setEditing(false) },
              )
            }
          >
            Link
          </Button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          Connect
        </Button>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  on,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  on: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/30 last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-foreground-muted">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          on ? 'bg-primary-500' : 'bg-surface-elevated border border-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
            on ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}
