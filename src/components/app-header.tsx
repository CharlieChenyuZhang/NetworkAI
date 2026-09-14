"use client";

import Link from "next/link";
import type { RefObject } from "react";
import {
  Bookmark,
  Compass,
  Grid2X2,
  LogOut,
  Plus,
  Search,
  WandSparkles,
} from "lucide-react";
import { Brand } from "./brand";
import { Avatar } from "./post-card";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { AuthUser } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AppView = "discover" | "mine" | "saved" | "studio";
const navigation = [
  { href: "/", view: "discover", label: "Discover", icon: Compass },
  { href: "/my-posts", view: "mine", label: "My posts", icon: Grid2X2 },
  { href: "/saved", view: "saved", label: "Saved posts", icon: Bookmark },
  { href: "/studio", view: "studio", label: "AI Studio", icon: WandSparkles },
] as const;

interface AppHeaderProps {
  view: AppView;
  user: AuthUser | null;
  query: string;
  onQueryChange: (query: string) => void;
  scope: "keywords" | "user";
  onScopeChange: (scope: "keywords" | "user") => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearch: () => void;
  onCreate: () => void;
  onSignOut: () => void;
}

export function AppHeader({
  view,
  user,
  query,
  onQueryChange,
  scope,
  onScopeChange,
  searchRef,
  onSearch,
  onCreate,
  onSignOut,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b bg-white">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4 sm:px-8 lg:flex-nowrap lg:py-0 xl:px-12">
        <Link href="/" aria-label="NetworkAI home" className="shrink-0">
          <Brand />
        </Link>
        <nav
          aria-label="Main navigation"
          className="hidden h-[76px] shrink-0 items-stretch gap-5 lg:flex xl:gap-6"
        >
          {navigation.map(({ href, view: itemView, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={view === itemView ? "page" : undefined}
              className={cn(
                "flex items-center border-b-2 text-sm transition-colors hover:text-foreground",
                view === itemView
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <form
          role="search"
          className="order-last flex h-10 min-w-0 w-full items-center gap-2 rounded-lg bg-muted px-3 lg:order-none lg:ml-auto lg:flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
        >
          <button
            type="submit"
            aria-label="Search"
            className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
          >
            <Search className="size-4" />
          </button>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            maxLength={500}
            placeholder={view === "mine" ? "Search your posts" : "Search posts"}
            aria-label={view === "mine" ? "Search your posts" : "Search posts"}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-none"
          />
          {view === "discover" && (
            <select
              aria-label="Search scope"
              value={scope}
              onChange={(event) =>
                onScopeChange(event.target.value as "keywords" | "user")
              }
              className="max-w-[86px] border-l bg-transparent py-1 pl-2 text-xs text-muted-foreground"
            >
              <option value="keywords">Caption</option>
              <option value="user">Creator</option>
            </select>
          )}
        </form>
        <div className="ml-auto flex shrink-0 items-center gap-4 lg:ml-0">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button aria-label="Account menu" className="rounded-full">
                  <Avatar name={user.username} className="size-9" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="max-w-52 truncate px-2 py-2 text-xs text-muted-foreground">
                  {user.username}
                </div>
                <DropdownMenuItem asChild>
                  <Link href="/my-posts">My posts</Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onSignOut}>
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              href="/login"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Log in
            </Link>
          )}
          <Button
            onClick={onCreate}
            aria-label="Create a post"
            className="h-10 rounded-lg px-4 text-sm"
          >
            <Plus className="size-4" />
            <span>Create</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function MobileNavigation({ view }: { view: AppView }) {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t bg-white pb-[max(6px,env(safe-area-inset-bottom))] pt-1 lg:hidden"
    >
      {navigation.map(({ href, view: itemView, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={view === itemView ? "page" : undefined}
          className={cn(
            "flex min-h-14 min-w-16 flex-col items-center justify-center gap-1 px-3 text-[11px]",
            view === itemView
              ? "font-semibold text-primary"
              : "text-muted-foreground",
          )}
        >
          <Icon className="size-5" strokeWidth={view === itemView ? 2 : 1.6} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
