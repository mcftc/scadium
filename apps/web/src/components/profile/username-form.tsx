'use client';

import { useState } from 'react';
import { Check, Loader2, Pencil } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { Button } from '@/components/ui/button';
import { useMe, type MeResponse } from '@/hooks/use-me';

/**
 * Inline editor for the user's display username. Validates the 3–20 char
 * alphanumeric rule locally before hitting the API; surfaces conflict errors
 * (username taken) inline.
 */
export function UsernameForm() {
  const { data: me } = useMe();
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(me?.username ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (username: string) =>
      api<MeResponse>('/me', {
        method: 'PATCH',
        body: { username },
        token,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(['me'], updated);
      setEditing(false);
      setLocalError(null);
    },
  });

  function submit() {
    const trimmed = value.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(trimmed)) {
      setLocalError('3–20 chars, letters, numbers, underscores');
      return;
    }
    mutation.mutate(trimmed);
  }

  const serverError =
    mutation.error instanceof ApiError ? mutation.error.message : null;
  const error = localError ?? serverError;

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
            Username
          </div>
          <div className="font-semibold">
            {me?.username ?? <span className="text-foreground-muted italic">Not set</span>}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setValue(me?.username ?? '');
            setEditing(true);
          }}
          aria-label="Edit username"
        >
          <Pencil className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
        Username
      </div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setLocalError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') setEditing(false);
          }}
          placeholder="your_name"
          className="flex-1 rounded-xl border border-border bg-surface-elevated px-4 h-11 text-sm focus:outline-none focus:border-primary-400"
          autoFocus
          maxLength={20}
        />
        <Button size="md" onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save
        </Button>
        <Button variant="secondary" size="md" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-danger mt-2">{error}</p>}
    </div>
  );
}
