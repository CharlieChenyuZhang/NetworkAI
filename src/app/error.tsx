"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 p-8 text-center">
      <h1 className="display-serif text-4xl">
        Something interrupted the view.
      </h1>
      <p className="text-muted-foreground">
        Please try again. Your published posts are safe.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
