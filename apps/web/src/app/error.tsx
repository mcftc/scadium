'use client';

// Root error boundary — catches unhandled runtime/render errors anywhere in the app
// so a single failing query or component shows a recoverable card instead of a blank
// white screen. Next.js renders this automatically for errors in the segment tree.
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-20">
      <Card>
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-foreground-muted">
            An unexpected error occurred. You can retry — your play balance is safe.
          </p>
          <Button variant="primary" className="w-full" onClick={() => reset()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
