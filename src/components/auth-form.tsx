"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function safeDestination(value: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(value)
  )
    return "/";
  const pathname = value.split(/[?#]/)[0];
  if (pathname === "/login" || pathname === "/register") return "/";
  return value;
}

function AuthFormContent({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, ready, signIn, register } = useAuth();
  const isRegistration = mode === "register";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const destination = safeDestination(searchParams.get("next"));
  const submitting = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ready && user) router.replace(destination);
  }, [ready, user, router, destination]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    if (!username.trim() || !password) {
      setError("Enter your username and password to continue.");
      return;
    }
    if (isRegistration && password !== confirmation) {
      setError("Your passwords do not match. Please try again.");
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      if (isRegistration) {
        await register(username.trim(), password);
        try {
          await signIn(username.trim(), password);
        } catch {
          toast.success("Your account is ready. Sign in to get started.");
          router.replace(`/login?next=${encodeURIComponent(destination)}`);
          return;
        }
        toast.success("Welcome to NetworkAI. Make yourself at home.");
      } else {
        await signIn(username.trim(), password);
        toast.success("Welcome back.");
      }
      router.replace(destination);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We could not connect. Please try again.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const alternativeUrl = `${isRegistration ? "/login" : "/register"}${destination === "/" ? "" : `?next=${encodeURIComponent(destination)}`}`;

  return (
    <div className="w-full max-w-[400px]">
      <div className="mb-9">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#66705f]">
          Your creative corner
        </p>
        <h1 className="display-serif text-4xl font-semibold tracking-[-0.045em] text-[#203d31]">
          {isRegistration ? "A little more you." : "Welcome back."}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[#66705f]">
          {isRegistration
            ? "Join a community of curious minds. Your next idea starts here."
            : "Good ideas, familiar faces, and a little inspiration are waiting for you."}
        </p>
      </div>
      <form
        onSubmit={handleSubmit}
        className="space-y-5"
        aria-label={
          isRegistration ? "Create your account" : "Sign in to your account"
        }
      >
        {error && (
          <div
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm leading-5 text-red-800 outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            {error}
          </div>
        )}
        <div className="space-y-2">
          <Label
            htmlFor="auth-username"
            className="text-xs font-semibold text-[#354b3e]"
          >
            Username
          </Label>
          <div className="relative">
            <UserRound
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-[#66705f]"
            />
            <Input
              id="auth-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={username}
              disabled={pending}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Your username"
              className="h-11 rounded-xl border-[#e2e6dc] bg-white pl-10 text-sm"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="auth-password"
            className="text-xs font-semibold text-[#354b3e]"
          >
            Password
          </Label>
          <div className="relative">
            <LockKeyhole
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-[#66705f]"
            />
            <Input
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={
                isRegistration ? "new-password" : "current-password"
              }
              required
              value={password}
              disabled={pending}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              className="h-11 rounded-xl border-[#e2e6dc] bg-white pl-10 pr-11 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-[#66705f] transition hover:text-[#234f3c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#234f3c]"
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>
        {isRegistration && (
          <div className="space-y-2">
            <Label
              htmlFor="auth-confirm-password"
              className="text-xs font-semibold text-[#354b3e]"
            >
              Confirm password
            </Label>
            <div className="relative">
              <LockKeyhole
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-3.5 size-4 text-[#66705f]"
              />
              <Input
                id="auth-confirm-password"
                name="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirmation}
                disabled={pending}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="One more time"
                className="h-11 rounded-xl border-[#e2e6dc] bg-white pl-10 text-sm"
              />
            </div>
          </div>
        )}
        <Button
          type="submit"
          disabled={pending || !ready}
          className="mt-2 h-11 w-full gap-2 rounded-xl bg-[#264e3d] text-sm font-medium text-white shadow-none hover:bg-[#1c3c2d]"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {pending
            ? isRegistration
              ? "Creating your account..."
              : "Signing in..."
            : isRegistration
              ? "Create account"
              : "Sign in"}
          {!pending && <ArrowRight className="size-4" aria-hidden="true" />}
        </Button>
        {isRegistration && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-[#66705f]">
            <Check className="size-3.5" aria-hidden="true" /> A place to create,
            share, and find your people.
          </p>
        )}
      </form>
      <p className="mt-7 text-center text-sm text-[#66705f]">
        {isRegistration ? "Already part of the community?" : "New around here?"}{" "}
        <Link
          href={alternativeUrl}
          className="font-semibold text-[#264e3d] underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#264e3d]"
        >
          {isRegistration ? "Sign in" : "Join us"}
        </Link>
      </p>
    </div>
  );
}

export function AuthForm(props: { mode: "login" | "register" }) {
  return (
    <Suspense
      fallback={
        <div role="status" className="p-8 text-sm text-[#66705f]">
          Getting your space ready...
        </div>
      }
    >
      <AuthFormContent {...props} />
    </Suspense>
  );
}

export default AuthForm;
