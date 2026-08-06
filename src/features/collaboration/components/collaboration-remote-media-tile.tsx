import { useEffect, useState } from "react";
import { Card, CardContent } from "@/ui/card";

export interface RemoteMediaShare {
  deviceId: string;
  stream: MediaStream;
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
    <Card size="flush">
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
      <CardContent className="flex items-center justify-between px-2 py-1 text-subtle-foreground">
        <span className="truncate">{share.deviceId}</span>
        <span>{hasVideo ? "screen" : "audio"}</span>
      </CardContent>
    </Card>
  );
}
