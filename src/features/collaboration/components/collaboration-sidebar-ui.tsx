import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";

export interface RemoteMediaShare {
  deviceId: string;
  stream: MediaStream;
}

function getProfileInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function ProfilePicture({ name, online }: { name: string; online?: boolean }) {
  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-bg text-[10px] font-medium text-text">
      {getProfileInitials(name)}
      {online !== undefined ? (
        <span
          className={cn(
            "-right-0.5 -bottom-0.5 absolute size-2 rounded-full border border-primary-bg bg-text-lighter/55",
            online && "bg-accent",
          )}
        />
      ) : null}
    </span>
  );
}

export function StatusDot({ online }: { online: boolean }) {
  return (
    <Tooltip content={online ? "Online" : "Offline"} side="top">
      <span className={cn("block size-2 rounded-full bg-text-lighter/55", online && "bg-accent")} />
    </Tooltip>
  );
}

export function SidebarHoverCard({ children, card }: { children: ReactNode; card: ReactNode }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  return (
    <div
      className="block min-w-0"
      onMouseEnter={(event) => setRect(event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setRect(null)}
      onFocus={(event) => setRect(event.currentTarget.getBoundingClientRect())}
      onBlur={() => setRect(null)}
    >
      {children}
      {rect
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[10060] w-56 rounded-xl border border-border bg-secondary-bg/95 p-2.5 text-xs shadow-lg backdrop-blur-sm"
              style={{
                left: Math.min(rect.right + 8, window.innerWidth - 232),
                top: Math.min(rect.top, window.innerHeight - 120),
              }}
            >
              {card}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function RemoteMediaTile({ share }: { share: RemoteMediaShare }) {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const hasVideo = share.stream.getVideoTracks().length > 0;

  useEffect(() => {
    if (videoElement && hasVideo) videoElement.srcObject = share.stream;
    if (audioElement) audioElement.srcObject = share.stream;

    return () => {
      if (videoElement) videoElement.srcObject = null;
      if (audioElement) audioElement.srcObject = null;
    };
  }, [audioElement, hasVideo, share.stream, videoElement]);

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-secondary-bg/45">
      {hasVideo ? (
        <video
          ref={setVideoElement}
          autoPlay
          playsInline
          muted
          className="aspect-video w-full bg-black"
        />
      ) : null}
      <audio ref={setAudioElement} autoPlay />
      <div className="flex items-center justify-between px-2 py-1 text-text-lighter text-[11px]">
        <span className="truncate">{share.deviceId}</span>
        <span>{hasVideo ? "screen" : "audio"}</span>
      </div>
    </div>
  );
}
