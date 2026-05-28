import { useEffect, useState } from "react";
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
    <span className="ui-text-xs relative flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary-bg font-medium text-text">
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
  if (!online) return null;

  return (
    <Tooltip content="Online" side="top">
      <span className="block size-2 rounded-full bg-accent" />
    </Tooltip>
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
      <div className="ui-text-xs flex items-center justify-between px-2 py-1 text-text-lighter">
        <span className="truncate">{share.deviceId}</span>
        <span>{hasVideo ? "screen" : "audio"}</span>
      </div>
    </div>
  );
}
