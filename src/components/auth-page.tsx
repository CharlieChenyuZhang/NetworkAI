import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "./brand";
import { AuthForm } from "./auth-form";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-6 px-6 py-6 sm:px-8">
        <Link href="/" aria-label="NetworkAI home">
          <Brand />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to discover
        </Link>
      </header>
      <section className="mx-auto w-full max-w-[448px] px-6 pb-16 pt-16 sm:pt-24">
        <AuthForm mode={mode} />
      </section>
    </main>
  );
}
