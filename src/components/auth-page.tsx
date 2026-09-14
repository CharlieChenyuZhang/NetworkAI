import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Brand } from "./brand";
import { AuthForm } from "./auth-form";
import { Suspense } from "react";
export function AuthPage({ mode }: { mode: "login" | "register" }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="relative flex flex-col px-6 py-7 sm:px-14 lg:px-20">
        <Link href="/" aria-label="NetworkAI home">
          <Brand />
        </Link>
        <div className="mx-auto flex w-full max-w-[390px] flex-1 flex-col justify-center py-16">
          <Link
            href="/"
            className="mb-10 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
          >
            <ArrowLeft className="size-4" /> Back to discover
          </Link>
          <Suspense fallback={<p>Loading your account form...</p>}>
            <AuthForm mode={mode} />
          </Suspense>
        </div>
        <p className="text-xs text-muted-foreground">
          A space for your ideas to find their people.
        </p>
      </section>
      <section className="relative hidden overflow-hidden bg-[#253f32] p-16 text-white lg:flex lg:flex-col lg:justify-between">
        <img
          src="/images/alpine-lake.jpg"
          alt="Alpine lake reflecting a mountain landscape"
          className="absolute inset-0 size-full object-cover opacity-45"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#132c23] via-transparent to-[#132c23]/30" />
        <span className="relative flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-[#d7e7ac]" /> A little inspiration
          goes a long way.
        </span>
        <div className="relative max-w-lg">
          <h2 className="display-serif text-6xl leading-[1.12] tracking-tight">
            Your perspective.
            <br />A world of possibilities.
          </h2>
          <p className="mt-6 max-w-sm text-base leading-7 text-white/75">
            Find something that moves you. Make something that&apos;s yours.
            Share it with a curious community.
          </p>
          <p className="mt-12 text-xs tracking-[0.2em] text-white/60">
            DISCOVER · CREATE · CONNECT
          </p>
        </div>
      </section>
    </main>
  );
}
