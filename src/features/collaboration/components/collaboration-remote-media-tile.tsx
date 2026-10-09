import { useEffect, useState } from "react";
import { Card } from "@/ui/card";

export interface RemoteMediaShare {
  deviceId: string;
  stream: MediaStream;
}

export function RemoteMediaTile({ share, name }: { share: RemoteMediaShare; name: string }) {
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
    <Card>
      {hasVideo ? (
        <video
          ref={setVideoElement}
          autoPlay
          playsInline
          muted
          className="aspect-video w-full bg-background"
        />
      ) : null}
      <audio ref={setAudioElement} autoPlay />
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-subtle-foreground">
        <span className="truncate">{name}</span>
        <span>{hasVideo ? "Screen" : "Audio"}</span>
      </div>
    </Card>
  );
}
