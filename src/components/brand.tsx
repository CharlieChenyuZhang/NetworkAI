import { cn } from "@/lib/utils";
export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 text-[20px] font-bold tracking-[-0.6px]",
        className,
      )}
    >
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-white">
        <svg
          width="23"
          height="23"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M5 18V6l14 12V6M5 12h14"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="19" cy="6" r="2.5" fill="#d7e7ac" />
        </svg>
      </span>
      {!compact && (
        <span>
          Network<span className="font-normal text-primary">AI</span>
        </span>
      )}
    </span>
  );
}
