"use client";
import { useState } from "react";
import { Bookmark, ImageIcon, Trash2 } from "lucide-react";
import type { InspirationPost } from "@/lib/inspiration";
import { cn } from "@/lib/utils";

export function Avatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
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
export function PostMedia({
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

export function PostCard({
  post,
  saved,
  owned,
  onOpen,
  onSave,
  onDelete,
}: {
  post: InspirationPost;
  saved: boolean;
  owned: boolean;
  onOpen: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="min-w-0">
      <div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
        {post.type === "video" ? (
          <PostMedia post={post} className="size-full object-contain" />
        ) : (
          <button
            aria-label={`View post: ${post.message}`}
            onClick={onOpen}
            className="block size-full"
          >
            <PostMedia post={post} className="size-full object-cover" />
          </button>
        )}
      </div>
      <div className="mt-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={onOpen}
            className="block w-full truncate text-left text-sm font-medium leading-6 hover:text-primary"
          >
            {post.message || "Untitled post"}
          </button>
          <div className="mt-1 flex items-center gap-2">
            <Avatar name={post.user} className="size-5 text-[9px]" />
            <span className="truncate text-xs leading-6 text-muted-foreground">
              {post.user}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            onClick={onSave}
            aria-label={`${saved ? "Unsave" : "Save"} post: ${post.message}`}
            aria-pressed={saved}
            className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary"
          >
            <Bookmark
              className={cn("size-4", saved && "fill-primary text-primary")}
            />
          </button>
          {owned && (
            <button
              onClick={onDelete}
              aria-label={`Delete post: ${post.message}`}
              className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
