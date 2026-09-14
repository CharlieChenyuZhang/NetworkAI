import Link from "next/link";
import { Brand } from "@/components/brand";
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Brand />
      <p className="text-sm text-muted-foreground">
        404 / A little off the beaten path
      </p>
      <h1 className="display-serif text-4xl">Let&apos;s find your way back.</h1>
      <Link
        href="/"
        className="rounded-full bg-primary px-6 py-3 text-sm text-white"
      >
        Back to discover
      </Link>
    </main>
  );
}
