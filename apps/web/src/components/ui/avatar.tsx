import { cn } from '@/lib/cn';

/**
 * Account avatar: renders the user's image (uploaded data URL or remote URL)
 * when set, otherwise a gradient tile with the name/wallet initial. Size and
 * rounding come from `className` so callers control the shape.
 */
export function Avatar({
  src,
  name,
  className,
}: {
  src?: string | null;
  name?: string | null;
  className?: string;
}) {
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase();
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={cn('object-cover', className)} />;
  }
  return (
    <span
      className={cn(
        'flex items-center justify-center bg-gradient-primary font-bold text-white',
        className,
      )}
    >
      {initial}
    </span>
  );
}
