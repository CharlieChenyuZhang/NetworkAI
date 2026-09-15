"use client";

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Download,
  ImagePlus,
  Loader2,
  Paperclip,
  Sparkles,
  UploadCloud,
  WandSparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createPost } from "@/lib/api";
import { UNAUTHORIZED_EVENT } from "@/lib/session";

interface PostComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished: () => void | Promise<void>;
  initialPrompt?: string;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const PROMPTS = [
  {
    label: "City photography",
    text: "A quiet sunlit street in Kyoto, a small coffee shop, warm film photography, soft sage green and cream tones, thoughtful composition.",
  },
  {
    label: "Surreal landscape",
    text: "A dreamlike greenhouse floating above the clouds, lush plants and curved glass, soft morning light, rich cinematic details.",
  },
  {
    label: "Minimal still life",
    text: "An editorial still life of a ceramic coffee cup and a single branch, natural window light, textured warm white background, minimal composition.",
  },
];

function mediaError(file: File) {
  if (!file.type.startsWith("image/") && !file.type.startsWith("video/"))
    return "Choose an image or video file.";
  if (file.type === "image/svg+xml")
    return "Choose a JPG, PNG, WebP, GIF, or other raster image.";
  if (
    file.size >
    (file.type.startsWith("video/") ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)
  )
    return file.type.startsWith("video/")
      ? "Your video is too large. Choose a file under 50 MB."
      : "Your image is too large. Choose a file under 10 MB.";
  if (file.size === 0) return "This file is empty. Please choose another.";
  return null;
}

export function PostComposer({
  open,
  onOpenChange,
  onPublished,
  initialPrompt,
}: PostComposerProps) {
  const { user, token, ready } = useAuth();
  const [message, setMessage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [media, setMedia] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [activeTab, setActiveTab] = useState("upload");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [draftScope, setDraftScope] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const generationController = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const initializedIdentity = useRef("");
  const draftKey = `networkai:composer:${user?.username ?? "guest"}`;

  useEffect(() => {
    if (!open) return;
    // Read the browser draft only after mount so server and client markup agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError("");
    if (initializedIdentity.current !== draftKey) {
      initializedIdentity.current = draftKey;
      setMedia(null);
      setGenerated(false);
      try {
        const draft = JSON.parse(sessionStorage.getItem(draftKey) ?? "{}") as {
          message?: unknown;
          prompt?: unknown;
        };
        setMessage(typeof draft.message === "string" ? draft.message : "");
        setPrompt(
          initialPrompt?.trim()
            ? initialPrompt
            : typeof draft.prompt === "string"
              ? draft.prompt
              : "",
        );
      } catch {
        setMessage("");
        setPrompt(initialPrompt ?? "");
      }
    } else if (initialPrompt?.trim()) {
      setPrompt(initialPrompt);
    }
    if (initialPrompt?.trim()) setActiveTab("ai");
    setDraftScope(draftKey);
  }, [open, draftKey, initialPrompt]);

  useEffect(() => {
    if (!open || draftScope !== draftKey) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ message, prompt }));
    } catch {
      // Creating a post remains available when browser storage is unavailable.
    }
  }, [message, prompt, draftScope, draftKey, open]);

  useEffect(() => {
    if (!media) {
      // Object URLs are browser resources and must be synchronized after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(media);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [media]);

  useEffect(() => () => generationController.current?.abort(), [token]);

  function chooseFile(file?: File) {
    if (!file || generating || publishing) return;
    const validationError = mediaError(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setMedia(file);
    setGenerated(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  function closeComposer(nextOpen: boolean) {
    if (publishing) return;
    if (!nextOpen) {
      generationController.current?.abort();
      generationController.current = null;
      setGenerating(false);
    }
    onOpenChange(nextOpen);
  }

  async function generateImage() {
    if (generationController.current || publishing || !token) return;
    if (!prompt.trim()) {
      setError("Describe the image you have in mind first.");
      return;
    }
    if (
      media?.type.startsWith("image/") &&
      !["image/png", "image/jpeg", "image/webp"].includes(media.type)
    ) {
      setError("AI image editing supports PNG, JPG, and WebP. Upload one of these formats, or remove the image to generate a new one.");
      return;
    }
    setError("");
    const controller = new AbortController();
    generationController.current = controller;
    setGenerating(true);
    try {
      const body = new FormData();
      body.append("prompt", prompt.trim());
      if (media?.type.startsWith("image/")) body.append("image", media);
      const response = await fetch("/api/ai/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
        signal: controller.signal,
      });
      if (response.status === 401) {
        window.dispatchEvent(
          new CustomEvent(UNAUTHORIZED_EVENT, { detail: { token } }),
        );
        throw new Error("Your session has expired. Please sign in again.");
      }
      const data = (await response.json()) as {
        image?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          data.error || "Image generation failed. Please try again.",
        );
      if (!data.image?.startsWith("data:image/"))
        throw new Error(
          "The image service returned an invalid image. Please try again.",
        );
      const imageResponse = await fetch(data.image, {
        signal: controller.signal,
      });
      const blob = await imageResponse.blob();
      const file = new File(
        [blob],
        `networkai-${Date.now()}.${blob.type === "image/jpeg" ? "jpg" : "png"}`,
        { type: blob.type || "image/png" },
      );
      const validationError = mediaError(file);
      if (validationError) throw new Error(validationError);
      if (controller.signal.aborted) return;
      setMedia(file);
      setGenerated(true);
      toast.success("Image ready. Review it before publishing.");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "We could not generate your image. Please try again.",
      );
    } finally {
      if (generationController.current === controller) {
        generationController.current = null;
        setGenerating(false);
      }
    }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || generating || !token) return;
    if (!media || !message.trim()) {
      setError(
        !media
          ? "Add an image or video to your post."
          : "Write a few words to go with your post.",
      );
      return;
    }
    submitting.current = true;
    setPublishing(true);
    setError("");
    try {
      await createPost(token, { message: message.trim(), media });
      setMessage("");
      setPrompt("");
      setMedia(null);
      setGenerated(false);
      initializedIdentity.current = "";
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Storage is optional. */
      }
      toast.success("Your post has been published.");
      onOpenChange(false);
      try {
        await onPublished();
      } catch {
        toast.info("Your post was published. Refresh the feed to see it.");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We could not publish your post. Your draft is still here.",
      );
    } finally {
      submitting.current = false;
      setPublishing(false);
    }
  }

  const busy = generating || publishing;
  const hasImage = media?.type.startsWith("image/");

  return (
    <Dialog open={open} onOpenChange={closeComposer}>
      <DialogContent
        className="max-h-[92dvh] gap-0 overflow-y-auto rounded-xl border-border bg-background p-0 sm:max-w-[640px]"
        onInteractOutside={(event) => {
          if (publishing) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (publishing) event.preventDefault();
        }}
      >
        <DialogHeader className="text-left border-b border-border px-6 py-5">
          <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">
            Create a post
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-muted-foreground">
            Add a caption and upload media or generate an image with AI.
          </DialogDescription>
        </DialogHeader>
        {!ready ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"
          >
            <Loader2 className="size-4 animate-spin" /> Loading...
          </div>
        ) : !user || !token ? (
          <div className="p-8 text-center">
            <p className="mb-5 text-sm text-muted-foreground">
              Sign in to share your ideas with the community.
            </p>
            <Button asChild className="rounded-xl bg-primary">
              <Link href="/login">Sign in to create</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={publish}>
            <div className="space-y-5 px-6 py-5">
              <div className="flex items-center gap-3">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase text-foreground"
                  aria-hidden="true"
                >
                  {user.username.slice(0, 2)}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {user.username}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Public post
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="post-caption"
                  className="text-sm font-medium text-foreground"
                >
                  Your story
                </Label>
                <Textarea
                  id="post-caption"
                  placeholder="Write a caption for your post..."
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={publishing}
                  maxLength={5000}
                  required
                  className="min-h-24 resize-y rounded-lg border-border bg-background text-sm leading-6 placeholder:text-muted-foreground"
                />
                <p className="text-right text-xs tabular-nums text-muted-foreground">
                  {message.length.toLocaleString()} / 5,000
                </p>
              </div>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4 grid h-10 w-full grid-cols-2 rounded-lg bg-muted p-1">
                  <TabsTrigger
                    value="upload"
                    className="gap-2 rounded-md text-sm data-[state=active]:bg-background data-[state=active]:text-foreground"
                  >
                    <Paperclip className="size-4" aria-hidden="true" /> Upload
                    media
                  </TabsTrigger>
                  <TabsTrigger
                    value="ai"
                    className="gap-2 rounded-md text-sm data-[state=active]:bg-background data-[state=active]:text-foreground"
                  >
                    <Sparkles className="size-4" aria-hidden="true" /> Create
                    with AI
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="upload" className="mt-0">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*,video/*"
                    aria-label="Choose an image or video"
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(event) => chooseFile(event.target.files?.[0])}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    disabled={busy}
                    className={`flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-5 py-7 text-center transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60 ${dragging ? "border-primary bg-muted" : "border-border bg-background hover:border-primary/50 hover:bg-muted/50"}`}
                  >
                    <div className="mb-3 p-1 text-muted-foreground">
                      <UploadCloud className="size-5" aria-hidden="true" />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {media
                        ? "Choose a different image or video"
                        : "Drop an image or video, or browse"}
                    </span>
                    <span className="mt-1.5 text-xs text-muted-foreground">
                      Images up to 10 MB · Videos up to 50 MB
                    </span>
                  </button>
                </TabsContent>
                <TabsContent value="ai" className="mt-0 space-y-3">
                  <div className="space-y-3">
                    <div className="mb-3 flex items-center gap-2">
                      <WandSparkles
                        className="size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Label
                        htmlFor="image-prompt"
                        className="text-sm font-medium text-foreground"
                      >
                        {hasImage
                          ? "Reimagine your image"
                          : "From a little thought to something visual"}
                      </Label>
                    </div>
                    <Textarea
                      id="image-prompt"
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      disabled={busy}
                      maxLength={4000}
                      placeholder={
                        hasImage
                          ? "Describe what you’d like to change about the image..."
                          : "A sunlit reading nook, wildflowers on the windowsill, warm film tones..."
                      }
                      className="min-h-24 resize-y rounded-lg border-border bg-background text-sm leading-6 placeholder:text-muted-foreground"
                    />
                    <div className="mt-2 flex items-center justify-between gap-4">
                      <p className="text-xs leading-4 text-muted-foreground">
                        {hasImage
                          ? "Your attached image is used as a reference."
                          : "Describe the subject, mood, colors, and style."}
                      </p>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {prompt.length} / 4,000
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {PROMPTS.map((suggestion) => (
                        <button
                          key={suggestion.label}
                          type="button"
                          disabled={busy}
                          onClick={() => setPrompt(suggestion.text)}
                          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                        >
                          {suggestion.label}
                        </button>
                      ))}
                    </div>
                    <Button
                      type="button"
                      onClick={generateImage}
                      disabled={busy || !prompt.trim()}
                      className="mt-4 h-10 w-full gap-2 rounded-lg bg-primary text-sm text-primary-foreground hover:bg-primary/90"
                    >
                      {generating ? (
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Sparkles className="size-4" aria-hidden="true" />
                      )}
                      {generating
                        ? "Generating image..."
                        : hasImage
                          ? "Reimagine image"
                          : "Generate image"}
                    </Button>
                    {generating && (
                      <div
                        role="status"
                        className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground"
                      >
                        <span>Generation can take a minute.</span>
                        <button
                          type="button"
                          onClick={() => {
                            generationController.current?.abort();
                            generationController.current = null;
                            setGenerating(false);
                          }}
                          className="rounded px-1 py-1 font-medium text-foreground underline underline-offset-2 focus-visible:outline-2"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
              {media && previewUrl && (
                <div className="overflow-hidden rounded-xl border border-border bg-muted">
                  <div className="relative flex max-h-72 min-h-28 items-center justify-center overflow-hidden">
                    {media.type.startsWith("video/") ? (
                      <video
                        src={previewUrl}
                        controls
                        className="max-h-72 w-full object-contain"
                        aria-label="Video preview"
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt="Preview of the image for your post"
                        className="max-h-72 w-full object-contain"
                      />
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setMedia(null);
                        setGenerated(false);
                      }}
                      aria-label="Remove attached media"
                      className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm transition hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      {generated ? (
                        <Sparkles className="size-4 shrink-0" />
                      ) : (
                        <ImagePlus className="size-4 shrink-0" />
                      )}
                      <span className="truncate">
                        {generated ? "AI-generated image" : media.name}
                      </span>
                      <span className="shrink-0">
                        {(media.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                    {generated && (
                      <a
                        href={previewUrl}
                        download={media.name}
                        className="flex shrink-0 items-center gap-1 rounded text-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        <Download className="size-3" aria-hidden="true" /> Save
                        image
                      </a>
                    )}
                  </div>
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-800"
                >
                  {error}
                </div>
              )}
            </div>
            <div className="flex flex-col items-stretch justify-between gap-3 border-t border-border bg-background px-6 py-4 sm:flex-row sm:items-center sm:gap-4">
              <p className="max-w-56 text-xs leading-4 text-muted-foreground">
                Text drafts are saved in this tab. Reattach media after
                reloading.
              </p>
              <Button
                type="submit"
                disabled={busy || !media || !message.trim()}
                className="h-10 shrink-0 gap-2 rounded-xl bg-primary px-5 text-sm text-primary-foreground shadow-none hover:bg-primary/90"
              >
                {publishing ? (
                  <Loader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                )}
                {publishing ? "Publishing..." : "Share your post"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
