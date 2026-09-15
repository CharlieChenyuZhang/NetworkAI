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
  Copy,
  ImageIcon,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./auth-provider";
import { PostComposer } from "./post-composer";
import {
  AppHeader,
  MobileNavigation,
  type AppView as View,
} from "./app-header";
import { PostCard, PostMedia } from "./post-card";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Skeleton } from "./ui/skeleton";
import { deletePost, searchPosts } from "@/lib/api";
import { inspirationPosts, type InspirationPost } from "@/lib/inspiration";
import { cn } from "@/lib/utils";

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
  const title = {
    discover: "Discover",
    mine: "My posts",
    saved: "Saved posts",
    studio: "AI Studio",
  }[view];
  const description =
    view === "discover"
      ? signedOut
        ? "A curated preview. Sign in to explore community posts."
        : "Recent images and ideas from the community."
      : view === "mine"
        ? "Everything you have shared, in one place."
        : view === "saved"
          ? `${saved.posts.length} saved ${saved.posts.length === 1 ? "post" : "posts"}. Stored in this browser.`
          : "Generate an image, refine it, and share a post.";

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="sr-only z-50 rounded bg-primary p-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <AppHeader
        view={view}
        user={user}
        query={query}
        onQueryChange={setQuery}
        scope={scope}
        onScopeChange={setScope}
        searchRef={searchInput}
        onSearch={() => {
          setSubmittedQuery(query.trim());
          setTopic("All inspiration");
          setVisibleCount(12);
          if (view === "studio")
            router.push(`/?q=${encodeURIComponent(query.trim())}`);
        }}
        onCreate={() => openComposer()}
        onSignOut={() => {
          signOut();
          router.push("/");
          toast.success("You are signed out");
        }}
      />
      <main
        id="main-content"
        className="mx-auto max-w-[1400px] px-5 pb-28 pt-8 sm:px-8 lg:pb-12 lg:pt-10 xl:px-12"
      >
        <div className="mb-7 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.8px] leading-tight sm:text-[32px]">
              {title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          {needsApi && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh posts"
              onClick={() => setRefresh((r) => r + 1)}
            >
              <RefreshCw className={cn("size-4", pending && "animate-spin")} />
            </Button>
          )}
        </div>
        {privateView && signedOut ? (
          <section className="mx-auto flex min-h-80 max-w-md flex-col items-center justify-center py-10 text-center">
            <LogIn className="mb-5 size-7 text-muted-foreground" />
            <h2 className="text-xl font-semibold">
              {view === "mine"
                ? "Sign in to view your posts"
                : "Sign in to create with AI"}
            </h2>
            <p className="mb-6 mt-3 text-sm leading-6 text-muted-foreground">
              {view === "mine"
                ? "Find and manage the posts you have shared."
                : "Generate and refine images before sharing them."}
            </p>
            <Button asChild>
              <Link
                href={`/login?next=${encodeURIComponent(view === "mine" ? "/my-posts" : "/studio")}`}
              >
                Sign in to continue
              </Link>
            </Button>
            <Link
              href="/register"
              className="mt-4 text-sm text-muted-foreground underline underline-offset-4"
            >
              Create an account
            </Link>
          </section>
        ) : view === "studio" ? (
          <section className="max-w-3xl">
            <div className="flex flex-col items-start gap-5 rounded-lg border p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Start with an idea</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Describe an image or upload a photo to edit.
                </p>
              </div>
              <Button onClick={() => openComposer()}>
                <Sparkles className="size-4" />
                Open studio
              </Button>
            </div>
            <h2 className="mb-3 mt-8 text-sm font-medium">Or try a prompt</h2>
            <div className="divide-y border-y">
              {prompts.map((prompt) => (
                <button
                  key={prompt.label}
                  onClick={() => openComposer(prompt.text)}
                  className="flex w-full items-center justify-between gap-5 py-5 text-left hover:text-primary"
                >
                  <span>
                    <span className="text-sm font-medium">{prompt.label}</span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      {prompt.text}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0" />
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-4 border-b pb-3">
              <div
                className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
                aria-label="Topics"
              >
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
                      "min-h-10 shrink-0 rounded-md px-3 text-sm transition-colors",
                      topic === item && !submittedQuery
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <select
                aria-label="Media type"
                value={mediaType}
                onChange={(event) => {
                  setMediaType(event.target.value);
                  setVisibleCount(12);
                }}
                className="h-10 max-w-[115px] shrink-0 rounded-md border bg-white px-2 text-sm"
              >
                <option value="all">All media</option>
                <option value="image">Images</option>
                <option value="video">Videos</option>
              </select>
            </div>
            {searchWord && (
              <div className="mb-5 flex items-center justify-between gap-4 text-sm">
                <p className="text-muted-foreground">
                  Results for{" "}
                  <strong className="font-medium text-foreground">
                    “{searchWord}”
                  </strong>
                  {view === "mine" ? " in your posts" : ""}
                </p>
                <button
                  onClick={clearSearch}
                  className="inline-flex min-h-9 shrink-0 items-center gap-2 text-muted-foreground hover:text-foreground"
                >
                  Clear filters
                  <X className="size-4" />
                </button>
              </div>
            )}
            {pending ? (
              <div
                className="feed-grid"
                aria-label="Loading posts"
                aria-busy="true"
              >
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index}>
                    <Skeleton className="aspect-[4/3] w-full rounded-lg" />
                    <Skeleton className="mt-4 h-4 w-3/4" />
                    <Skeleton className="mt-3 h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <div
                role="alert"
                className="flex min-h-72 flex-col items-center justify-center p-8 text-center"
              >
                <ImageIcon className="mb-4 size-7 text-muted-foreground" />
                <h2 className="text-lg font-semibold">
                  We couldn&apos;t load the community.
                </h2>
                <p className="mb-5 mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
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
              <div className="flex min-h-72 flex-col items-center justify-center px-5 py-10 text-center">
                {view === "saved" ? (
                  <Bookmark className="mb-4 size-7 text-muted-foreground" />
                ) : (
                  <Search className="mb-4 size-7 text-muted-foreground" />
                )}
                <h2 className="text-xl font-semibold">
                  {searchWord || mediaType !== "all"
                    ? "No matching posts"
                    : view === "saved"
                      ? "No saved posts yet"
                      : view === "mine"
                        ? "No posts yet"
                        : "No community posts yet"}
                </h2>
                <p className="mb-5 mt-2 text-sm leading-6 text-muted-foreground">
                  {searchWord || mediaType !== "all"
                    ? "Try another search or clear your filters."
                    : view === "saved"
                      ? "Save a post to find it here later."
                      : "Share an image or video to get started."}
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
                    <Plus className="size-4" />
                    Create your first post
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="feed-grid">
                  {displayPosts.slice(0, visibleCount).map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      saved={saved.posts.some((p) => p.id === post.id)}
                      owned={!post.sample && post.user === user?.username}
                      onOpen={() => setSelected(post)}
                      onSave={() => saved.toggle(post)}
                      onDelete={() => setDeleteTarget(post)}
                    />
                  ))}
                </div>
                {displayPosts.length > visibleCount && (
                  <div className="mt-10 text-center">
                    <Button
                      variant="outline"
                      onClick={() => setVisibleCount((count) => count + 12)}
                    >
                      Load more
                      <ArrowDown className="size-4" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>
      <MobileNavigation view={view} />
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
                    ? "Preview image"
                    : `Post by ${selected.user}`}
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
    </div>
  );
}
