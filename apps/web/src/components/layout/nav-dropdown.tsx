'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/cn';

/**
 * Click-to-open dropdown for the header. Closes on outside click, Escape, or
 * route change.
 *
 * Desktop (≥ lg): opens downward as an absolute popover under the trigger.
 * Mobile (< lg): the SAME menu opens as a bottom-anchored sheet that slides up
 * from the bottom of the screen, with a dimmed backdrop and a drag-handle
 * affordance. Dismisses on backdrop tap / Escape / route change / item tap.
 *
 * Used for the Games, SCAD Engine, and Affiliates menus.
 */
export function NavDropdown({
  label,
  icon,
  active,
  children,
  align = 'left',
  width = 'w-64',
}: {
  label: string;
  icon?: ReactNode;
  active?: boolean;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Header switches its layout at `lg` (desktop nav is `hidden lg:flex`); below
  // that the dropdowns render as a bottom sheet.
  const isMobile = useMediaQuery('(max-width: 1023px)');

  const close = () => setOpen(false);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Desktop: close on outside click. Escape closes in both modes.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!isMobile && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, isMobile]);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isMobile]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold whitespace-nowrap transition-colors',
          active || open
            ? 'bg-surface-elevated text-foreground'
            : 'text-foreground-muted hover:bg-surface hover:text-foreground',
        )}
      >
        {icon}
        {label}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {/* Desktop popover — unchanged. */}
      {open && !isMobile && (
        <div
          role="menu"
          className={cn(
            'absolute top-full mt-2 z-50 rounded-xl border border-border bg-surface/95 backdrop-blur-xl p-1.5 shadow-xl',
            width,
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children(close)}
        </div>
      )}

      {/* Mobile bottom sheet — same menu content, slides up from the bottom. */}
      {isMobile && <BottomSheet open={open} label={label} onClose={close}>{children}</BottomSheet>}
    </div>
  );
}

/** Portal-rendered, slide-up bottom sheet with a dimmed backdrop. */
function BottomSheet({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] lg:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={onClose}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          {/* Sheet */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface/95 backdrop-blur-xl p-3 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"
          >
            {/* Drag handle */}
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden />
            <div className="mb-2 px-1.5 text-[10px] uppercase tracking-wider text-foreground-muted/70">
              {label}
            </div>
            {children(onClose)}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
