'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useMe, useUpdateProfile } from '@/hooks/use-me';
import { cn } from '@/lib/cn';

const PRESETS: readonly (readonly [string, string, string])[] = [
  ['#f59e0b', '#ef4444', '🚀'],
  ['#22d3ee', '#3b82f6', '🎰'],
  ['#a855f7', '#ec4899', '💎'],
  ['#34d399', '#10b981', '🍀'],
  ['#f472b6', '#a855f7', '👑'],
  ['#60a5fa', '#14b8a6', '🔥'],
];

function presetUrl([a, b, emoji]: readonly [string, string, string]): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="url(#g)"/><text x="64" y="90" font-size="62" text-anchor="middle">${emoji}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('bad image'));
    };
    img.src = url;
  });
}

/** Square-crop + resize to 128px and encode as a compact webp data URL. */
async function fileToAvatar(file: File): Promise<string> {
  const img = await loadImage(file);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL('image/webp', 0.85);
}

export function PhotoSection() {
  const { data: me } = useMe();
  const update = useUpdateProfile();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  const name = me.username ?? me.walletAddress;

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Image too large (max 8MB).');
      return;
    }
    try {
      update.mutate({ avatarUrl: await fileToAvatar(file) });
    } catch {
      setError('Could not read that image.');
    }
  }

  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-foreground-muted">Profile photo</label>
      <div className="mt-3 flex items-center gap-4">
        <Avatar src={me.avatarUrl} name={name} className="h-16 w-16 shrink-0 rounded-2xl text-xl" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFile}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={update.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Upload
          </Button>
          {me.avatarUrl && (
            <Button
              variant="ghost"
              size="sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ avatarUrl: '' })}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-foreground-muted mb-2">
          Or pick one
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => {
            const url = presetUrl(p);
            const selected = me.avatarUrl === url;
            return (
              <button
                key={i}
                type="button"
                disabled={update.isPending}
                onClick={() => update.mutate({ avatarUrl: url })}
                className={cn(
                  'h-12 w-12 overflow-hidden rounded-xl border-2 transition-colors',
                  selected ? 'border-primary-400' : 'border-transparent hover:border-border',
                )}
              >
                <Avatar src={url} className="h-full w-full" />
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-xs text-danger mt-2">{error}</p>}
    </div>
  );
}
