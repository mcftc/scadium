import { cn } from '@/lib/cn';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative h-8 w-8">
        <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
          <defs>
            <linearGradient id="scadium-logo" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#EE86FF" />
              <stop offset="100%" stopColor="#6F5FCC" />
            </linearGradient>
          </defs>
          <circle cx="16" cy="16" r="14" fill="url(#scadium-logo)" />
          <path
            d="M11 20 Q16 10 21 20"
            stroke="white"
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="21" cy="20" r="1.8" fill="white" />
        </svg>
      </div>
      <span className="text-xl font-bold tracking-tight">
        Scad<span className="text-gradient">ium</span>
      </span>
    </div>
  );
}
