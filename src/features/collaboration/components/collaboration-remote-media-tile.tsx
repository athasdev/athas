import { useEffect, useState } from "react";

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
      <div className="ui-text-sm flex items-center justify-between px-2 py-1 text-text-lighter">
        <span className="truncate">{share.deviceId}</span>
        <span>{hasVideo ? "screen" : "audio"}</span>
      </div>
    </div>
  );
}
