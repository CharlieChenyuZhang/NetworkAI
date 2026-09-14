"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Compass,
  Copy,
  Feather,
  Grid2X2,
  HelpCircle,
  ImageIcon,
  Layers,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Brand } from "./brand";
import { useAuth } from "./auth-provider";
import { PostComposer } from "./post-composer";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Skeleton } from "./ui/skeleton";
import { deletePost, searchPosts } from "@/lib/api";
import { inspirationPosts, type InspirationPost } from "@/lib/inspiration";
import { cn } from "@/lib/utils";

type View = "discover" | "mine" | "saved" | "studio";
const links = [
  { href: "/", view: "discover", label: "Discover", icon: Compass },
  { href: "/my-posts", view: "mine", label: "My posts", icon: Grid2X2 },
  { href: "/saved", view: "saved", label: "Saved posts", icon: Bookmark },
] as const;
const topics = [
  "All inspiration",
  "Nature",
  "Architecture",
  "Photography",
  "Art",
  "Design",
];
const prompts = [
  {
    label: "Somewhere unexpected",
    text: "A tiny cabin on a floating island above the clouds, soft morning light, cinematic photography",
    image: "/images/mountain.jpg",
  },
  {
    label: "A quieter world",
    text: "A tranquil Japanese garden after rain, delicate moss, soft mist, editorial photography",
    image: "/images/forest.jpg",
  },
  {
    label: "Space to dream",
    text: "A sunlit minimalist room with organic furniture, warm natural textures and a view of the sea",
    image: "/images/interior.jpg",
  },
];
function savedSubscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("networkai:saved", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("networkai:saved", listener);
  };
}
function useSaved(username?: string) {
  const key = `networkai:saved:${username || "guest"}`;
  const raw = useSyncExternalStore(
    savedSubscribe,
    () => {
      try {
        return localStorage.getItem(key) || "[]";
      } catch {
        return "[]";
      }
    },
    () => "[]",
  );
  const posts = useMemo<InspirationPost[]>(() => {
    try {
      const data = JSON.parse(raw);
      return Array.isArray(data)
        ? data
            .filter(
              (p) =>
                p &&
                typeof p.id === "string" &&
                typeof p.message === "string" &&
                typeof p.url === "string" &&
                typeof p.user === "string" &&
                ["image", "video"].includes(p.type),
            )
            .slice(0, 100)
        : [];
    } catch {
      return [];
    }
  }, [raw]);
  const toggle = (post: InspirationPost) => {
    const exists = posts.some((p) => p.id === post.id);
    try {
      localStorage.setItem(
        key,
        JSON.stringify(
          exists
            ? posts.filter((p) => p.id !== post.id)
            : [post, ...posts].slice(0, 100),
        ),
      );
      window.dispatchEvent(new Event("networkai:saved"));
      toast.success(
        exists ? "Removed from saved posts" : "Saved to this browser",
      );
    } catch {
      toast.error("Your browser could not save this post.");
    }
  };
  return { posts, toggle };
}
function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e9eede] text-[11px] font-semibold text-primary",
        className,
      )}
    >
      {name
        .split(/[\s._-]/)
        .map((word) => word[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()}
    </span>
  );
}
function PostMedia({
  post,
  className,
}: {
  post: InspirationPost;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div
        className={cn(
          "flex min-h-52 flex-col items-center justify-center gap-3 bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageIcon className="size-8" />
        <span className="text-sm">This media is unavailable</span>
      </div>
    );
  if (post.type === "video")
    return (
      <video
        src={post.url}
        className={className}
        controls
        preload="metadata"
        aria-label={post.message || "Community video"}
        onError={() => setFailed(true)}
      />
    );
  return (
    <img
      src={post.url}
      alt={post.message || `Image shared by ${post.user}`}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

interface NetworkAppProps {
  view: View;
  initialQuery?: string;
}
export function NetworkApp(props: NetworkAppProps) {
  const { token } = useAuth();
  return (
    <NetworkAppContent
      key={`${token || "guest"}:${props.view}:${props.initialQuery || ""}`}
      {...props}
    />
  );
}
function NetworkAppContent({ view, initialQuery = "" }: NetworkAppProps) {
  const { user, token, ready, signOut } = useAuth();
  const router = useRouter();
  const saved = useSaved(user?.username);
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [scope, setScope] = useState<"keywords" | "user">("keywords");
  const [topic, setTopic] = useState("All inspiration");
  const [mediaType, setMediaType] = useState("all");
  const [posts, setPosts] = useState<InspirationPost[]>([]);
  const [load, setLoad] = useState<{
    status: "idle" | "loading" | "done" | "error";
    error?: string;
    key?: string;
  }>({ status: "idle" });
  const [refresh, setRefresh] = useState(0);
  const [visibleCount, setVisibleCount] = useState(12);
  const [composer, setComposer] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState("");
  const [selected, setSelected] = useState<InspirationPost | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InspirationPost | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [help, setHelp] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const privateView = view === "mine" || view === "studio";
  const signedOut = ready && !token;
  const searchWord =
    submittedQuery || (topic === "All inspiration" ? "" : topic);
  const requestKey = `${token}:${view}:${view === "mine" ? "" : searchWord}:${scope}:${refresh}`;
  const needsApi = !!token && (view === "discover" || view === "mine");

  useEffect(() => {
    if (!needsApi || !token) return;
    const controller = new AbortController();
    const options =
      view === "mine"
        ? { user: user?.username }
        : scope === "user"
          ? { user: searchWord }
          : { keywords: searchWord };
    const fetchData = async () => {
      setLoad({ status: "loading", key: requestKey });
      try {
        const data = await searchPosts(token, options, controller.signal);
        if (!controller.signal.aborted) {
          setPosts(data);
          setLoad({ status: "done", key: requestKey });
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setLoad({
            status: "error",
            error: err instanceof Error ? err.message : "Could not load posts.",
            key: requestKey,
          });
      }
    };
    void fetchData();
    return () => controller.abort();
  }, [needsApi, token, view, searchWord, scope, user?.username, requestKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openComposer = (prompt = "") => {
    if (!token) {
      router.push(`/login?next=${encodeURIComponent("/studio")}`);
      return;
    }
    setInitialPrompt(prompt);
    setComposer(true);
  };
  const allPosts =
    view === "saved" ? saved.posts : token ? posts : inspirationPosts;
  const displayPosts = allPosts.filter((post) => {
    if (mediaType !== "all" && post.type !== mediaType) return false;
    if (token && view === "discover") return true;
    const haystack =
      scope === "user" ? post.user : `${post.message} ${post.category || ""}`;
    return (
      !searchWord || haystack.toLowerCase().includes(searchWord.toLowerCase())
    );
  });
  const pending =
    !ready ||
    (needsApi &&
      (load.key !== requestKey ||
        load.status === "loading" ||
        load.status === "idle"));
  const loadError =
    needsApi && load.key === requestKey && load.status === "error";
  const clearSearch = () => {
    setQuery("");
    setSubmittedQuery("");
    setTopic("All inspiration");
    setMediaType("all");
    setVisibleCount(12);
  };
  const onPublished = useCallback(() => {
    setRefresh((r) => r + 1);
    toast.info("Your post may take a moment to appear in search.");
  }, []);
  const removePost = async () => {
    if (!token || !deleteTarget || deleteTarget.user !== user?.username) return;
    setDeleting(true);
    try {
      await deletePost(token, deleteTarget.id);
      setPosts((current) => current.filter((p) => p.id !== deleteTarget.id));
      if (saved.posts.some((p) => p.id === deleteTarget.id))
        saved.toggle(deleteTarget);
      setSelected(null);
      setDeleteTarget(null);
      toast.success("Post deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not delete the post.",
      );
    } finally {
      setDeleting(false);
    }
  };
  const pageTitle =
    view === "mine"
      ? "Your corner of the creative world."
      : view === "saved"
        ? "Good ideas are worth keeping."
        : "Make room for your imagination.";

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded bg-primary p-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[230px] flex-col overflow-y-auto border-r bg-[#fdfefa] px-5 py-8 lg:flex xl:w-[248px] xl:px-6">
        <Link href="/" className="mb-14 pl-2" aria-label="NetworkAI home">
          <Brand />
        </Link>
        <p className="mb-4 pl-4 text-[10px] font-semibold tracking-[0.18em] text-[#66705f]">
          YOUR CREATIVE SPACE
        </p>
        <nav aria-label="Main navigation" className="space-y-1.5">
          {links.map(({ href, view: itemView, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={view === itemView ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-lg px-4 text-[13px] transition-colors hover:bg-[#edf1e7]",
                view === itemView
                  ? "bg-[#e9efdf] font-semibold text-[#315238]"
                  : "text-[#6f776d]",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.7} />
              {label}
              {itemView === "saved" && saved.posts.length > 0 && (
                <span className="ml-auto text-[11px]">
                  {saved.posts.length}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="my-6 border-t" />
        <Link
          href="/studio"
          aria-current={view === "studio" ? "page" : undefined}
          className={cn(
            "flex h-11 items-center gap-3 rounded-lg px-4 text-[13px] hover:bg-[#edf1e7]",
            view === "studio"
              ? "bg-[#e9efdf] font-semibold text-primary"
              : "text-[#6f776d]",
          )}
        >
          <WandSparkles className="size-[18px]" strokeWidth={1.7} />
          AI Studio
          <span className="ml-auto rounded border border-[#dfe7cf] bg-[#f2f5e9] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary">
            CREATE
          </span>
        </Link>
        <Button
          className="mt-8 h-11 w-full gap-2 rounded-lg text-xs"
          onClick={() => openComposer()}
        >
          <Plus className="size-4" /> Create a post
        </Button>
        <div className="mt-auto pt-12">
          <div className="relative overflow-hidden rounded-xl bg-[#edf0e3] p-4">
            <div className="mb-3 flex size-8 items-center justify-center rounded-lg bg-[#dfe7cc]">
              <Sparkles className="size-4 text-primary" />
            </div>
            <p className="display-serif text-[19px] leading-6">
              A spark is all it takes.
            </p>
            <p className="mt-2 text-[11px] leading-[1.8] text-[#66705f]">
              Turn that what-if into something wonderful.
            </p>
            <Link
              href="/studio"
              className="mt-4 inline-flex items-center gap-2 text-[11px] font-semibold text-primary"
            >
              Explore AI Studio <ArrowRight className="size-3" />
            </Link>
          </div>
          <button
            onClick={() => setHelp(true)}
            className="mt-5 flex w-full items-center gap-3 px-3 py-2 text-xs text-muted-foreground hover:text-primary"
          >
            <HelpCircle className="size-4" /> A little help
          </button>
          <p className="px-3 pt-3 text-[11px] text-[#66705f]">
            © {new Date().getFullYear()} NetworkAI
          </p>
        </div>
      </aside>

      <div className="lg:ml-[230px] xl:ml-[248px]">
        <header className="sticky top-0 z-20 flex h-[82px] items-center gap-3 sm:gap-5 border-b bg-[#fafbf8]/95 px-5 backdrop-blur sm:px-8 xl:px-11">
          <Link
            href="/"
            className="shrink-0 lg:hidden"
            aria-label="NetworkAI home"
          >
            <Brand compact />
          </Link>
          <span className="hidden shrink-0 text-[13px] font-semibold lg:block">
            {view === "discover"
              ? "Discover"
              : view === "mine"
                ? "My posts"
                : view === "saved"
                  ? "Saved posts"
                  : "AI Studio"}
          </span>
          <form
            role="search"
            className="mx-auto flex h-10 min-w-0 w-full max-w-[410px] items-center gap-2 rounded-lg border border-[#e7e9e2] bg-white px-3"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmittedQuery(query.trim());
              setTopic("All inspiration");
              setVisibleCount(12);
              if (view === "studio")
                router.push(`/?q=${encodeURIComponent(query.trim())}`);
            }}
          >
            <Search
              className="size-4 shrink-0 text-[#66705f]"
              aria-hidden="true"
            />
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                view === "mine"
                  ? "Search your posts..."
                  : "Find your next inspiration..."
              }
              aria-label={
                view === "mine" ? "Search your posts" : "Search posts"
              }
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[#66705f] focus-visible:outline-none"
            />
            <button
              type="submit"
              aria-label="Search"
              className="rounded px-1 py-1 text-muted-foreground hover:text-primary"
            >
              <ArrowRight className="size-3.5" />
            </button>
            <kbd className="hidden rounded border bg-[#fafbf7] px-1.5 py-0.5 text-[11px] text-[#66705f] sm:block">
              ⌘ K
            </kbd>
          </form>
          <div className="flex shrink-0 items-center gap-3">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Account menu"
                    className="flex items-center gap-2 rounded-lg"
                  >
                    <Avatar name={user.username} />
                    <span className="hidden max-w-24 truncate text-xs font-medium xl:block">
                      {user.username}
                    </span>
                    <ChevronDown className="hidden size-3 text-muted-foreground sm:block" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/my-posts">My posts</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      signOut();
                      router.push("/");
                      toast.success("You are signed out");
                    }}
                  >
                    <LogOut className="size-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden text-xs font-medium text-[#6b7569] hover:text-primary sm:block"
                >
                  Log in
                </Link>
                <Button
                  size="sm"
                  asChild
                  className="h-9 rounded-lg px-4 text-[11px]"
                >
                  <Link href="/register">
                    <span className="sm:hidden">Join</span><span className="hidden sm:inline">Join community</span><ArrowRight className="hidden size-3.5 sm:block" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </header>

        <main
          id="main-content"
          className="mx-auto max-w-[1660px] px-5 pb-28 pt-7 sm:px-8 sm:pt-8 lg:pb-12 xl:px-11"
        >
          {view === "discover" ? (
            <section className="hero-grain relative mb-8 flex min-h-[272px] overflow-hidden rounded-2xl bg-[#edf1e3] p-7 sm:p-9 xl:min-h-[290px] xl:p-10">
              <div className="relative z-10 w-full sm:max-w-[62%] xl:max-w-[56%]">
                <span className="inline-flex items-center gap-2 rounded-full border border-[#dce3cf] bg-[#f7f9f1]/70 px-2.5 py-1 text-[11px] font-medium tracking-[0.1em] text-[#6c795f]">
                  <span className="size-1.5 rounded-full bg-[#71845c]" /> A HOME
                  FOR CURIOUS MINDS
                </span>
                <h1 className="display-serif mt-5 text-[32px] leading-[1.12] tracking-[-1.1px] text-[#2e4633] sm:text-[39px] xl:text-[46px]">
                  A little inspiration.
                  <br />
                  <span className="italic">Endless possibilities.</span>
                </h1>
                <p className="mt-4 max-w-[355px] text-xs leading-[1.8] text-[#66705f]">
                  Discover a new perspective. Share a piece of your world.
                  <br className="hidden xl:block" /> Create something only you
                  could imagine.
                </p>
                <button
                  onClick={() => openComposer()}
                  className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-[#355335]"
                >
                  Let&apos;s create something{" "}
                  <ArrowRight className="size-3.5" />
                </button>
              </div>
              <div
                aria-hidden="true"
                className="absolute inset-y-0 right-0 hidden w-[43%] overflow-hidden sm:block"
              >
                <div className="absolute -right-6 -top-12 size-[370px] rounded-full border border-[#d6deca]" />
                <div className="absolute -right-12 -top-16 size-[420px] rounded-full border border-[#d6deca]/60" />
                <div className="absolute right-[24%] top-10 h-[205px] w-[158px] rotate-[-13deg] overflow-hidden rounded-lg border-[5px] border-white bg-white shadow-xl shadow-[#4d6042]/15 xl:right-[32%] xl:h-[230px] xl:w-[173px]">
                  <img
                    src="/images/alpine-lake.jpg"
                    alt=""
                    className="size-full object-cover"
                  />
                </div>
                <div className="absolute -right-3 top-[78px] h-[210px] w-[170px] rotate-[12deg] rounded-lg border-[5px] border-white bg-white shadow-xl shadow-[#4d6042]/15 xl:right-[3%] xl:top-[66px] xl:h-[225px] xl:w-[176px]">
                  <img
                    src="/images/interior.jpg"
                    alt=""
                    className="h-[86%] w-full rounded-sm object-cover"
                  />
                  <div className="pt-1.5 text-center font-serif text-[10px] italic text-[#7a816c]">
                    a different kind of everyday
                  </div>
                </div>
                <span className="absolute right-[13%] top-7 flex size-10 rotate-12 items-center justify-center rounded-xl bg-[#d7e4b9] text-[#52643b] shadow-sm">
                  <Sparkles className="size-5" />
                </span>
              </div>
            </section>
          ) : (
            <section className="mb-9 pt-3">
              <p className="mb-3 text-[10px] font-semibold tracking-[0.17em] text-primary">
                {view === "mine"
                  ? "MADE BY YOU"
                  : view === "saved"
                    ? "YOUR PERSONAL COLLECTION"
                    : "FROM WHAT IF TO WHAT’S NEXT"}
              </p>
              <h1 className="display-serif text-3xl tracking-tight sm:text-[40px]">
                {pageTitle}
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                {view === "mine"
                  ? "The moments, experiments, and ideas you have shared."
                  : view === "saved"
                    ? "Your bookmarks, kept in this browser. A little inspiration for later."
                    : "Bring an idea to life with AI, then make it part of your story."}
              </p>
            </section>
          )}

          {privateView && signedOut ? (
            <section className="flex min-h-[370px] flex-col items-center justify-center rounded-2xl border bg-white p-8 text-center">
              <span className="mb-5 grid size-14 place-items-center rounded-full bg-[#edf1e3]">
                <LogIn className="size-6 text-primary" />
              </span>
              <h2 className="display-serif text-3xl">
                {view === "mine"
                  ? "A space of your own."
                  : "Your next idea starts here."}
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
                {view === "mine"
                  ? "Sign in to find, search, and manage everything you have shared."
                  : "Sign in to generate images, refine your ideas, and share them with the community."}
              </p>
              <Button asChild className="mt-6">
                <Link
                  href={`/login?next=${encodeURIComponent(view === "mine" ? "/my-posts" : "/studio")}`}
                >
                  Sign in to continue <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Link href="/register" className="mt-4 text-xs text-primary">
                New here? Create an account
              </Link>
            </section>
          ) : view === "studio" ? (
            <section>
              <div className="relative overflow-hidden rounded-2xl border border-[#dce3d0] bg-[#edf1e3] p-7 sm:p-10">
                <WandSparkles className="mb-5 size-8 text-primary" />
                <h2 className="display-serif text-3xl">
                  What&apos;s on your mind?
                </h2>
                <p className="mb-7 mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                  A place that doesn&apos;t exist. A fresh take on an everyday
                  moment. Start with a few words and see where they take you.
                </p>
                <Button onClick={() => openComposer()}>
                  <Sparkles className="size-4" /> Open the creative studio{" "}
                  <ArrowRight className="size-4" />
                </Button>
                <p className="mt-4 text-xs text-muted-foreground">
                  Generate an image, add your story, and preview before
                  publishing.
                </p>
              </div>
              <h2 className="mb-5 mt-9 text-sm font-semibold">
                Need a starting point?
              </h2>
              <div className="grid gap-5 sm:grid-cols-3">
                {prompts.map((prompt) => (
                  <button
                    key={prompt.label}
                    onClick={() => openComposer(prompt.text)}
                    className="group overflow-hidden rounded-xl border bg-white text-left"
                  >
                    <img
                      src={prompt.image}
                      alt=""
                      className="h-44 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    <span className="flex items-center justify-between p-4 text-sm font-medium">
                      {prompt.label}
                      <ArrowRight className="size-4 text-primary" />
                    </span>
                    <span className="block px-4 pb-4 text-[11px] text-muted-foreground">
                      Use this prompt · Photo inspiration
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h2 className="text-[21px] font-semibold tracking-[-0.6px]">
                    {view === "discover"
                      ? "Find your next spark"
                      : view === "mine"
                        ? "Your posts"
                        : "Saved for later"}
                  </h2>
                  <p className="mt-1.5 text-xs text-[#66705f]">
                    {signedOut && view === "discover"
                      ? "A curated preview. Sign in to explore community posts."
                      : view === "mine"
                        ? "Search your own posts by caption."
                        : view === "saved"
                          ? `${saved.posts.length} saved ${saved.posts.length === 1 ? "post" : "posts"} · Only on this browser`
                          : "Fresh perspectives from the community."}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {token && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Refresh posts"
                      onClick={() => setRefresh((r) => r + 1)}
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                  )}
                  <div
                    className="flex rounded-lg border bg-white p-1"
                    role="group"
                    aria-label="Media type"
                  >
                    {[
                      ["all", "All work"],
                      ["image", "Images"],
                      ["video", "Videos"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => {
                          setMediaType(value);
                          setVisibleCount(12);
                        }}
                        aria-pressed={mediaType === value}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-[10px]",
                          mediaType === value
                            ? "bg-[#f0f2eb] font-semibold text-primary"
                            : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mb-6 mt-6 flex flex-wrap items-center justify-between gap-4 border-b pb-5">
                <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
                  {topics.map((item) => (
                    <button
                      key={item}
                      onClick={() => {
                        setTopic(item);
                        setSubmittedQuery("");
                        setQuery("");
                        setScope("keywords");
                        setVisibleCount(12);
                      }}
                      aria-pressed={topic === item && !submittedQuery}
                      className={cn(
                        "shrink-0 rounded-full border px-3.5 py-2 text-[10px] transition-colors",
                        topic === item && !submittedQuery
                          ? "border-[#3b5d43] bg-[#3b5d43] text-white"
                          : "border-[#e4e7df] bg-white text-[#66705f] hover:border-primary",
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                {view === "discover" && (
                  <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    Search by
                    <select
                      aria-label="Search scope"
                      value={scope}
                      onChange={(e) =>
                        setScope(e.target.value as "keywords" | "user")
                      }
                      className="rounded-md border bg-white px-2 py-1.5 text-foreground"
                    >
                      <option value="keywords">Caption</option>
                      <option value="user">Creator</option>
                    </select>
                  </label>
                )}
              </div>
              {searchWord && (
                <div className="mb-5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Results for{" "}
                    <strong className="font-semibold text-foreground">
                      “{searchWord}”
                    </strong>
                    {view === "mine" ? " in your posts" : ""}
                  </span>
                  <button
                    onClick={clearSearch}
                    className="flex items-center gap-1 text-primary"
                  >
                    Clear filters <X className="size-3" />
                  </button>
                </div>
              )}
              {pending ? (
                <div
                  className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
                  aria-label="Loading posts"
                  aria-busy="true"
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i}>
                      <Skeleton
                        className={cn(
                          "w-full rounded-xl",
                          i % 2 ? "h-72" : "h-56",
                        )}
                      />
                      <Skeleton className="mt-4 h-4 w-3/4" />
                      <Skeleton className="mt-3 h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : loadError ? (
                <div
                  role="alert"
                  className="flex min-h-64 flex-col items-center justify-center rounded-xl border bg-white p-8 text-center"
                >
                  <Layers className="mb-4 size-7 text-muted-foreground" />
                  <h3 className="text-lg font-medium">
                    We couldn&apos;t load the community.
                  </h3>
                  <p className="mb-5 mt-2 max-w-sm text-sm text-muted-foreground">
                    {load.error}
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => setRefresh((r) => r + 1)}
                  >
                    Try again
                  </Button>
                </div>
              ) : displayPosts.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
                  <span className="mb-4 grid size-12 place-items-center rounded-full bg-[#edf1e3]">
                    {view === "saved" ? (
                      <Bookmark className="size-5 text-primary" />
                    ) : (
                      <Search className="size-5 text-primary" />
                    )}
                  </span>
                  <h3 className="display-serif text-2xl">
                    {searchWord || mediaType !== "all"
                      ? "A fresh search might spark something."
                      : view === "saved"
                        ? "Make a little room for inspiration."
                        : view === "mine"
                          ? "Your story starts with one post."
                          : "Be the first to share something."}
                  </h3>
                  <p className="mb-5 mt-2 max-w-sm text-sm text-muted-foreground">
                    {searchWord || mediaType !== "all"
                      ? "Try another word or clear the filters to see more."
                      : view === "saved"
                        ? "Tap the bookmark on any post to keep it here."
                        : "A moment, an idea, a different perspective. Make it yours."}
                  </p>
                  {searchWord || mediaType !== "all" ? (
                    <Button variant="outline" onClick={clearSearch}>
                      Clear filters
                    </Button>
                  ) : view === "saved" ? (
                    <Button asChild variant="outline">
                      <Link href="/">Explore posts</Link>
                    </Button>
                  ) : (
                    <Button onClick={() => openComposer()}>
                      <Plus className="size-4" /> Create your first post
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="feed-grid">
                    {displayPosts.slice(0, visibleCount).map((post, index) => (
                      <article key={post.id} className="group">
                        <div
                          className="relative overflow-hidden rounded-xl bg-[#e8ece2]"
                          style={{
                            aspectRatio:
                              post.aspect ||
                              (index % 3 === 1 ? "4 / 5" : "4 / 3"),
                          }}
                        >
                          {post.type === "video" ? (
                            <PostMedia post={post} className="w-full" />
                          ) : (
                            <button
                              className="block size-full overflow-hidden text-left"
                              onClick={() => setSelected(post)}
                              aria-label={`View post: ${post.message}`}
                            >
                              <PostMedia
                                post={post}
                                className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
                              />
                              <span className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/5" />
                            </button>
                          )}
                          <span className="absolute left-3 top-3 rounded-md bg-white/90 px-2 py-1 text-[10px] font-semibold tracking-wide text-[#5d6955] backdrop-blur">
                            {post.sample
                              ? post.category
                              : post.type === "video"
                                ? "VIDEO"
                                : "COMMUNITY"}
                          </span>
                          <button
                            aria-label={
                              saved.posts.some((p) => p.id === post.id)
                                ? `Unsave post: ${post.message}`
                                : `Save post: ${post.message}`
                            }
                            aria-pressed={saved.posts.some(
                              (p) => p.id === post.id,
                            )}
                            onClick={() => saved.toggle(post)}
                            className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-white/95 text-[#4a5945] shadow-sm hover:bg-[#edf1e3]"
                          >
                            <Bookmark
                              className={cn(
                                "size-3.5",
                                saved.posts.some((p) => p.id === post.id) &&
                                  "fill-primary text-primary",
                              )}
                            />
                          </button>
                        </div>
                        <button
                          onClick={() => setSelected(post)}
                          className="mt-3 block w-full truncate text-left text-[12px] font-medium tracking-[-0.15px] hover:text-primary"
                        >
                          {post.message || "A moment worth sharing"}
                        </button>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar
                              name={post.user}
                              className={cn(
                                "size-5 text-[7px]",
                                index % 3 === 1 &&
                                  "bg-[#ece5dd] text-[#66705f]",
                                index % 3 === 2 &&
                                  "bg-[#e5e7ed] text-[#666a81]",
                              )}
                            />
                            <span className="truncate text-[11px] text-[#66705f]">
                              {post.user}
                            </span>
                          </span>
                          {post.sample ? (
                            <span className="shrink-0 text-[11px] text-[#66705f]">
                              INSPIRATION
                            </span>
                          ) : (
                            post.user === user?.username && (
                              <button
                                onClick={() => setDeleteTarget(post)}
                                aria-label={`Delete post: ${post.message}`}
                                className="rounded p-1 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  {displayPosts.length > visibleCount ? (
                    <div className="mt-5 text-center">
                      <Button
                        variant="outline"
                        onClick={() => setVisibleCount((count) => count + 12)}
                      >
                        A little more inspiration{" "}
                        <ArrowDown className="size-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-7 flex items-center justify-center gap-3 text-[11px] text-[#66705f]">
                      <span className="h-px w-10 bg-border" />
                      <Feather className="size-3.5" />
                      {signedOut && view === "discover"
                        ? "A world of inspiration is waiting for you."
                        : "You’re all caught up. Go make something."}
                      <span className="h-px w-10 bg-border" />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t bg-[#fdfefa]/95 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden"
      >
        {[
          ...links,
          {
            href: "/studio",
            view: "studio",
            label: "AI Studio",
            icon: WandSparkles,
          },
        ].map(({ href, view: itemView, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={view === itemView ? "page" : undefined}
            className={cn(
              "flex min-w-16 flex-col items-center gap-1 rounded-lg px-3 py-2 text-[11px]",
              view === itemView
                ? "bg-[#edf1e3] font-semibold text-primary"
                : "text-muted-foreground",
            )}
          >
            <Icon className="size-[19px]" />
            {label}
          </Link>
        ))}
        <button
          onClick={() => openComposer()}
          aria-label="Create a post"
          className="grid size-10 place-items-center rounded-xl bg-primary text-white"
        >
          <Plus className="size-5" />
        </button>
      </nav>
      {token && (
        <PostComposer
          key={token}
          open={composer}
          onOpenChange={setComposer}
          onPublished={onPublished}
          initialPrompt={initialPrompt}
        />
      )}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6">
                  {selected.sample
                    ? "A little inspiration"
                    : `A moment from ${selected.user}`}
                </DialogTitle>
                <DialogDescription>
                  {selected.sample
                    ? "Curated photography for inspiration. These are example posts, not live community activity."
                    : `Shared by ${selected.user}`}
                </DialogDescription>
              </DialogHeader>
              <PostMedia
                key={selected.id}
                post={selected}
                className="max-h-[55dvh] w-full rounded-lg object-contain"
              />
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {selected.message}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => saved.toggle(selected)}
                >
                  <Bookmark className="size-4" />
                  {saved.posts.some((p) => p.id === selected.id)
                    ? "Unsave"
                    : "Save post"}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(selected.message);
                      toast.success("Caption copied");
                    } catch {
                      toast.error(
                        "Could not copy. Select the caption to copy it manually.",
                      );
                    }
                  }}
                >
                  <Copy className="size-4" /> Copy caption
                </Button>
                {!selected.sample && selected.user === user?.username && (
                  <Button
                    variant="ghost"
                    className="ml-auto text-destructive"
                    onClick={() => setDeleteTarget(selected)}
                  >
                    <Trash2 className="size-4" /> Delete
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              This removes the post from the community. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Keep post
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={removePost}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}Delete
              post
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>A little help finding your way.</DialogTitle>
            <DialogDescription>
              Discover, create, and make yourself at home.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-3 text-sm leading-6">
            {[
              [
                "Discover",
                "Sign in to browse recent community posts. Search by caption or by an exact creator username.",
              ],
              [
                "Make it yours",
                "Upload a photo or video, or use AI Studio to generate and refine an image before publishing.",
              ],
              [
                "Keep your favorites",
                "Bookmarks stay in this browser and are separate for each account.",
              ],
              [
                "Your posts",
                "Search your published captions in My posts. You can remove your own posts; published posts cannot be edited with the current service.",
              ],
            ].map(([title, description]) => (
              <div key={title}>
                <h3 className="mb-1 flex items-center gap-2 font-semibold">
                  <Check className="size-4 text-primary" />
                  {title}
                </h3>
                <p className="pl-6 text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
