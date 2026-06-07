'use client';

import { Eraser, Minus, Plus, Shuffle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatUsd } from '@/lib/format';
import { NumberPicker } from './number-picker';

export interface TicketRow {
  main: number[];
  bonus: number | null;
}

export function isCompleteTicket(t: TicketRow, mainCount: number): boolean {
  return t.main.length === mainCount && t.bonus !== null;
}

/**
 * bc.game-style ticket list builder. Up to `maxManualRows` ticket cards are
 * shown in a 2-column grid, each with its number picker ALWAYS OPEN (no edit
 * toggle); cards start empty — Quick Pick fills them all, the per-card dice
 * rerolls one. Any quantity beyond the visible cards is bought as
 * auto-generated random tickets. Quantity is unlimited. Pure controlled
 * component: the parent owns all state.
 */
export function TicketListBuilder({
  tickets,
  quantity,
  autoCount,
  completedCount,
  maxManualRows,
  mainCount,
  mainMax,
  bonusMax,
  priceUsd,
  presets,
  disabled,
  onSetQuantity,
  onAddRow,
  onRemoveRow,
  onRerollRow,
  onClearRow,
  onClearAll,
  onQuickPickAll,
  onToggleMain,
  onPickBonus,
}: {
  tickets: TicketRow[];
  quantity: number;
  autoCount: number;
  completedCount: number;
  maxManualRows: number;
  mainCount: number;
  mainMax: number;
  bonusMax: number;
  priceUsd: number;
  presets: number[];
  disabled?: boolean;
  onSetQuantity: (n: number) => void;
  onAddRow: () => void;
  onRemoveRow: (i: number) => void;
  onRerollRow: (i: number) => void;
  onClearRow: (i: number) => void;
  onClearAll: () => void;
  onQuickPickAll: () => void;
  onToggleMain: (i: number, n: number) => void;
  onPickBonus: (i: number, n: number) => void;
}) {
  const manualCount = tickets.length;

  return (
    <div className="space-y-4">
      {/* Quantity: free numeric input (no upper bound) + preset chips. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-foreground-muted">Tickets</span>
        <div className="flex items-center rounded-xl border border-border bg-surface-elevated overflow-hidden">
          <button
            type="button"
            disabled={disabled || quantity <= 1}
            onClick={() => onSetQuantity(quantity - 1)}
            className="px-2.5 py-2 text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="One less ticket"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <input
            type="number"
            min={1}
            value={quantity}
            disabled={disabled}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              onSetQuantity(Number.isFinite(n) && n >= 1 ? n : 1);
            }}
            className="w-20 bg-transparent text-center text-sm font-bold font-mono outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSetQuantity(quantity + 1)}
            className="px-2.5 py-2 text-foreground-muted hover:text-foreground disabled:opacity-40"
            aria-label="One more ticket"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {presets.map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onSetQuantity(n)}
            className={cn(
              'rounded-xl border px-3 py-2 text-xs font-bold transition-colors disabled:opacity-50',
              quantity === n
                ? 'border-primary-400/60 bg-primary-400/10 text-primary-300'
                : 'border-border bg-surface-elevated text-foreground-muted hover:border-primary-400/50 hover:text-foreground',
            )}
          >
            {n}×
          </button>
        ))}
      </div>

      {/* bc.game toolbar: completion counter + Clear All + Quick Pick. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">
          Completed{' '}
          <span className="font-mono text-primary-300">
            {completedCount} / {manualCount}
          </span>{' '}
          Ticket{manualCount === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onClearAll}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-elevated px-2.5 py-1.5 text-[11px] font-semibold text-foreground-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            <Eraser className="h-3 w-3" />
            Clear All
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onQuickPickAll}
            className="flex items-center gap-1.5 rounded-lg border border-primary-400/50 bg-primary-400/10 px-2.5 py-1.5 text-[11px] font-bold text-primary-300 hover:bg-primary-400/20 transition-colors disabled:opacity-50"
          >
            <Shuffle className="h-3 w-3" />
            Quick Pick
          </button>
        </div>
      </div>

      {/* Ticket cards, pickers always open (bc.game 2-column layout). */}
      <div className="grid sm:grid-cols-2 gap-3">
        {tickets.map((t, i) => {
          const picked = t.main.length + (t.bonus !== null ? 1 : 0);
          const complete = isCompleteTicket(t, mainCount);
          return (
            <div
              key={i}
              className={cn(
                'rounded-xl border bg-surface-elevated/40 p-3 space-y-3 transition-colors',
                complete ? 'border-primary-400/40' : 'border-border',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-foreground-muted">#{i + 1}</span>
                  <span
                    className={cn(
                      'text-[10px] font-mono',
                      complete ? 'text-success' : 'text-foreground-muted',
                    )}
                  >
                    {picked}/{mainCount + 1}
                  </span>
                </div>
                <div className="flex items-center gap-0.5">
                  <RowAction
                    label="Clear this ticket"
                    onClick={() => onClearRow(i)}
                    disabled={disabled || picked === 0}
                  >
                    <Eraser className="h-3.5 w-3.5" />
                  </RowAction>
                  <RowAction
                    label="Randomize this ticket"
                    onClick={() => onRerollRow(i)}
                    disabled={disabled}
                  >
                    <Shuffle className="h-3.5 w-3.5" />
                  </RowAction>
                  <RowAction
                    label="Remove this ticket"
                    onClick={() => onRemoveRow(i)}
                    disabled={disabled || manualCount <= 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </RowAction>
                </div>
              </div>
              <NumberPicker
                mainMax={mainMax}
                mainCount={mainCount}
                bonusMax={bonusMax}
                main={t.main}
                bonus={t.bonus}
                onToggleMain={(n) => onToggleMain(i, n)}
                onPickBonus={(n) => onPickBonus(i, n)}
                disabled={disabled}
              />
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={disabled || manualCount >= maxManualRows}
        onClick={onAddRow}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-xs font-semibold text-foreground-muted transition-colors hover:border-primary-400/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        {manualCount >= maxManualRows ? `Max ${maxManualRows} manual tickets` : 'Add ticket'}
      </button>

      {/* Summary: manual + auto breakdown, bc.game style. */}
      <div className="rounded-xl border border-border bg-surface-elevated/40 px-3 py-2.5 text-xs">
        {autoCount > 0 ? (
          <span>
            <span className="font-bold text-foreground">{manualCount} manual</span>
            <span className="text-foreground-muted"> + </span>
            <span className="font-bold text-primary-300">{autoCount} auto random</span>
            <span className="text-foreground-muted"> = </span>
            <span className="font-bold text-foreground">{quantity} tickets</span>
            <span className="text-foreground-muted"> · </span>
            <span className="font-mono font-bold text-foreground">
              {formatUsd(quantity * priceUsd)} USDT
            </span>
          </span>
        ) : (
          <span>
            <span className="font-bold text-foreground">
              {quantity} ticket{quantity === 1 ? '' : 's'}
            </span>
            <span className="text-foreground-muted"> · </span>
            <span className="font-mono font-bold text-foreground">
              {formatUsd(quantity * priceUsd)} USDT
            </span>
          </span>
        )}
        {autoCount > 0 && (
          <p className="mt-1 text-[10px] text-foreground-muted">
            The first {maxManualRows} tickets are yours to edit — the remaining {autoCount} are
            random quick-picks generated at purchase.
          </p>
        )}
      </div>
    </div>
  );
}

function RowAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg p-1.5 text-foreground-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}
