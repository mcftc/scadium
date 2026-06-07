'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, MessageCircle, X } from 'lucide-react';
import { useChat, type ChatMessage } from '@/hooks/use-chat';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { shortAddress, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Floating chat panel that slides in from the right. Toggleable on mobile,
 * persistent on desktop via the prop. Uses the useChat hook so the socket
 * stays open across route changes.
 */
export function ChatPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { messages, send, error, connected, canPost } = useChat();
  const { open: openWallet } = useWalletModal();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function submit() {
    const body = draft.trim();
    if (!body) return;
    if (!canPost) {
      openWallet();
      return;
    }
    send(body);
    setDraft('');
  }

  return (
    <>
      {/* Mobile toggle button — hidden on desktop (lg+) where the panel is pinned */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'fixed bottom-5 right-5 z-40 lg:hidden h-12 w-12 rounded-full bg-gradient-primary shadow-glow flex items-center justify-center text-white',
          open && 'hidden',
        )}
        aria-label="Open chat"
      >
        <MessageCircle className="h-5 w-5" />
      </button>

      <aside
        className={cn(
          'fixed right-0 top-16 bottom-0 z-30 w-full sm:w-96 bg-surface border-l border-border flex flex-col transition-transform',
          open ? 'translate-x-0' : 'translate-x-full',
          'lg:translate-x-0 lg:relative lg:right-auto lg:top-auto lg:bottom-auto lg:w-full lg:h-full lg:border-l-0 lg:bg-transparent lg:z-auto',
        )}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-border">
          <div className="flex items-center gap-2">
            <div
              className={cn('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : 'bg-muted')}
            />
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground-muted">
              General chat
            </span>
            <span className="text-xs text-foreground-muted">{messages.length}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="lg:hidden text-foreground-muted hover:text-foreground"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {messages.length === 0 && (
            <div className="py-16 text-center text-xs text-foreground-muted">
              No messages yet. Say hi.
            </div>
          )}
          {messages.map((m) => (
            <ChatRow key={m.id} msg={m} />
          ))}
        </div>

        {error && (
          <div className="mx-3 mb-2 px-3 py-2 text-[11px] rounded-lg bg-danger/10 text-danger border border-danger/30">
            {error}
          </div>
        )}

        <div className="shrink-0 p-3 border-t border-border bg-surface/80">
          <div className="flex gap-2 items-center">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder={canPost ? 'Type a message...' : 'Connect wallet to chat'}
              maxLength={500}
              className="flex-1 min-w-0 rounded-lg border border-border bg-background px-3 h-9 text-xs focus:outline-none focus:border-primary-400 placeholder:text-foreground-muted/50"
            />
            <button
              type="button"
              onClick={submit}
              className="shrink-0 h-9 w-9 rounded-lg bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center text-white transition-colors"
              aria-label="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

function ChatRow({ msg }: { msg: ChatMessage }) {
  const isAdmin = msg.user.role === 'admin' || msg.user.role === 'moderator';
  const name = msg.user.username ?? shortAddress(msg.user.walletAddress);
  return (
    <div className="group px-2 py-1.5 rounded-lg hover:bg-surface-elevated/50">
      <div className="flex items-baseline gap-1.5">
        {/* solpump-style level badge */}
        {msg.user.level !== undefined && (
          <span className="shrink-0 rounded bg-surface-elevated px-1 py-px text-[9px] font-mono font-bold text-primary-300">
            {msg.user.level}
          </span>
        )}
        <span
          className={cn(
            'text-xs font-semibold truncate',
            isAdmin ? 'text-primary-400' : 'text-foreground',
          )}
        >
          {name}
        </span>
        <span className="text-[10px] text-foreground-muted shrink-0">
          {formatDate(msg.createdAt)}
        </span>
      </div>
      <div className="text-sm text-foreground-muted break-words">{msg.body}</div>
    </div>
  );
}
