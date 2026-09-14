"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ApiError, login, registerAccount } from "@/lib/api";
import {
  persistSession,
  readSession,
  sessionFromToken,
  TOKEN_KEY,
  UNAUTHORIZED_EVENT,
} from "@/lib/session";
import type { AuthUser, Session } from "@/lib/types";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  ready: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  register: (username: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function createSessionStore() {
  const serverSnapshot: { session: Session | null; ready: boolean } = {
    session: null,
    ready: false,
  };
  let snapshot = serverSnapshot;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe: (listener: () => void) => {
      if (!snapshot.ready) {
        const session = readSession();
        snapshot = { session, ready: true };
        if (!session) persistSession(null);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (session: Session | null) => {
      snapshot = { session, ready: true };
      listeners.forEach((listener) => listener());
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createSessionStore);
  const { session, ready } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const activeSignIn = useRef<AbortController | null>(null);

  const signOut = useCallback(() => {
    activeSignIn.current?.abort();
    activeSignIn.current = null;
    persistSession(null);
    store.set(null);
  }, [store]);

  useEffect(() => {
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== TOKEN_KEY && event.key !== null) return;
      activeSignIn.current?.abort();
      store.set(readSession());
    };
    const handleUnauthorized = (event: Event) => {
      const rejectedToken = (event as CustomEvent<{ token: string }>).detail
        ?.token;
      if (rejectedToken && rejectedToken === store.getSnapshot().session?.token)
        signOut();
    };
    const checkExpiration = () => {
      const expiresAt = store.getSnapshot().session?.expiresAt;
      if (expiresAt != null && expiresAt <= Date.now()) signOut();
    };
    window.addEventListener("storage", syncStorage);
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    window.addEventListener("focus", checkExpiration);
    document.addEventListener("visibilitychange", checkExpiration);
    return () => {
      activeSignIn.current?.abort();
      window.removeEventListener("storage", syncStorage);
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
      window.removeEventListener("focus", checkExpiration);
      document.removeEventListener("visibilitychange", checkExpiration);
    };
  }, [signOut, store]);

  useEffect(() => {
    if (session?.expiresAt == null) return;
    const expiresAt = session.expiresAt;
    let timer: ReturnType<typeof setTimeout>;
    const scheduleExpiration = () => {
      if (store.getSnapshot().session?.token !== session.token) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        signOut();
        return;
      }
      timer = setTimeout(
        scheduleExpiration,
        Math.min(remaining, 2_147_483_647),
      );
    };
    scheduleExpiration();
    return () => clearTimeout(timer);
  }, [session, signOut, store]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      activeSignIn.current?.abort();
      const controller = new AbortController();
      activeSignIn.current = controller;
      try {
        const token = await login(username, password, controller.signal);
        controller.signal.throwIfAborted();
        const next = sessionFromToken(token, username.trim());
        if (!next) {
          throw new ApiError(
            "The service returned an invalid session. Please sign in again.",
            502,
          );
        }
        persistSession(next);
        store.set(next);
      } finally {
        if (activeSignIn.current === controller) activeSignIn.current = null;
      }
    },
    [store],
  );

  const register = useCallback(async (username: string, password: string) => {
    await registerAccount(username, password);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        token: session?.token ?? null,
        ready,
        signIn,
        signOut,
        register,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
