import { cn } from "@/lib/utils";

/**
 * Static guide avatar with a text bubble. Deliberately no TTS or lip-sync:
 * P2 scope is "static avatar + text", and narration is already readable text.
 */
export function GuideAvatar({
  name = "小漫",
  message,
  className,
}: {
  name?: string;
  message: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5", className)} role="group" aria-label="讲解员">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/avatars/voyage-guide.svg"
        alt={`${name} 头像`}
        width={40}
        height={40}
        className="size-10 shrink-0 rounded-full border border-border bg-accent"
      />
      <div className="relative min-w-0 rounded-2xl rounded-tl-sm border border-border bg-background px-3 py-2">
        <p className="text-[11px] font-medium text-primary">{name}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-foreground">{message}</p>
      </div>
    </div>
  );
}
