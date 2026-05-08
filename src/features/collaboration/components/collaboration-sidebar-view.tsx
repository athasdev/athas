import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowClockwise,
  ChatCircleText,
  FilePlus,
  FileText,
  GearSix,
  Microphone as Mic,
  Monitor,
  PaperPlaneTilt,
  UsersThree,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  appendCollaborationChatMessage,
  appendCollaborationSharedDocuments,
  buildCollaborationSidebarModel,
} from "@/features/collaboration/lib/collaboration-sidebar-model";
import { chatComposerIconButtonClassName } from "@/features/ai/components/input/chat-composer-control-styles";
import { useCollaborationRuntimeStore } from "@/features/collaboration/stores/collaboration-runtime-store";
import {
  fetchCollaborationMediaSignals,
  getCollaborationClientId,
  postCollaborationMediaSignal,
  updateCollaborationChannelNote,
  type CollaborationMediaSignal,
} from "@/features/window/services/auth-api";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { PANE_CHIP_BASE, PaneIconButton, paneChipClassName, paneHeaderClassName } from "@/ui/pane";
import Textarea from "@/ui/textarea";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { getBaseName } from "@/utils/path-helpers";

type ShareState = "idle" | "active" | "error";

interface RemoteMediaShare {
  deviceId: string;
  stream: MediaStream;
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    if (track.readyState !== "ended") {
      track.stop();
    }
  });
}

function RemoteMediaTile({ share }: { share: RemoteMediaShare }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hasVideo = share.stream.getVideoTracks().length > 0;

  useEffect(() => {
    if (videoRef.current && hasVideo) videoRef.current.srcObject = share.stream;
    if (audioRef.current) audioRef.current.srcObject = share.stream;

    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
      if (audioRef.current) audioRef.current.srcObject = null;
    };
  }, [hasVideo, share.stream]);

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-secondary-bg/45">
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full bg-black" />
      ) : null}
      <audio ref={audioRef} autoPlay />
      <div className="flex items-center justify-between px-2 py-1 text-text-lighter text-[11px]">
        <span className="truncate">{share.deviceId}</span>
        <span>{hasVideo ? "screen" : "audio"}</span>
      </div>
    </div>
  );
}

export function CollaborationSidebarView() {
  const user = useAuthStore((state) => state.user);
  const collaboration = useAuthStore((state) => state.subscription?.collaboration);
  const setCollaborationSnapshot = useAuthStore((state) => state.setCollaborationSnapshot);
  const presenceTarget = useCollaborationRuntimeStore((state) => state.presenceTarget);
  const activeDocumentStream = useCollaborationRuntimeStore((state) => state.activeDocumentStream);
  const mediaState = useCollaborationRuntimeStore((state) => state.mediaState);
  const collaborationActions = useCollaborationRuntimeStore((state) => state.actions);
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [micState, setMicState] = useState<ShareState>("idle");
  const [screenState, setScreenState] = useState<ShareState>("idle");
  const micStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteSharesRef = useRef<RemoteMediaShare[]>([]);
  const lastMediaSignalIdRef = useRef(0);
  const localDeviceIdRef = useRef<string | null>(null);
  const [remoteShares, setRemoteShares] = useState<RemoteMediaShare[]>([]);

  const model = useMemo(
    () =>
      buildCollaborationSidebarModel({
        collaboration,
        selectedChannelId: presenceTarget.channelId,
      }),
    [collaboration, presenceTarget.channelId],
  );
  const selectedChannel = model?.selectedChannel ?? null;
  const selectedNoteContent = model?.selectedNote?.contentMarkdown ?? "";
  const remoteDeviceIds = useMemo(() => {
    if (!selectedChannel || !collaboration?.presence) return [];
    const localDeviceId = localDeviceIdRef.current ?? getCollaborationClientId();
    localDeviceIdRef.current = localDeviceId;
    return Array.from(
      new Set(
        collaboration.presence
          .filter(
            (presence) =>
              presence.status === "online" &&
              presence.channelId === selectedChannel.id &&
              presence.deviceId !== localDeviceId,
          )
          .map((presence) => presence.deviceId),
      ),
    );
  }, [collaboration?.presence, selectedChannel]);

  useEffect(() => {
    return () => {
      stopMediaStream(micStreamRef.current);
      stopMediaStream(screenStreamRef.current);
      remoteSharesRef.current.forEach((share) => stopMediaStream(share.stream));
      peerConnectionsRef.current.forEach((peerConnection) => peerConnection.close());
    };
  }, []);

  const setRemoteShareList = useCallback(
    (updater: (shares: RemoteMediaShare[]) => RemoteMediaShare[]) => {
      setRemoteShares((shares) => {
        const nextShares = updater(shares);
        const nextDeviceIds = new Set(nextShares.map((share) => share.deviceId));
        for (const share of shares) {
          if (!nextDeviceIds.has(share.deviceId)) {
            stopMediaStream(share.stream);
          }
        }
        remoteSharesRef.current = nextShares;
        return nextShares;
      });
    },
    [],
  );

  const getLocalDeviceId = useCallback(() => {
    const deviceId = localDeviceIdRef.current ?? getCollaborationClientId();
    localDeviceIdRef.current = deviceId;
    return deviceId;
  }, []);

  const getLocalTracks = useCallback(
    () => [
      ...(micStreamRef.current?.getAudioTracks() ?? []),
      ...(screenStreamRef.current?.getVideoTracks() ?? []),
    ],
    [],
  );

  const postMediaSignal = useCallback(
    async (
      recipientDeviceId: string | null,
      kind: "offer" | "answer" | "ice" | "leave",
      payload: Record<string, unknown>,
    ) => {
      if (!selectedChannel) return;
      await postCollaborationMediaSignal({
        channelId: selectedChannel.id,
        senderDeviceId: getLocalDeviceId(),
        recipientDeviceId,
        kind,
        payload,
      });
    },
    [getLocalDeviceId, selectedChannel],
  );

  const ensurePeerConnection = useCallback(
    (remoteDeviceId: string) => {
      const existing = peerConnectionsRef.current.get(remoteDeviceId);
      if (existing) return existing;

      const peerConnection = new RTCPeerConnection();
      getLocalTracks().forEach((track) => {
        const sourceStream =
          track.kind === "audio" ? micStreamRef.current : screenStreamRef.current;
        if (sourceStream) peerConnection.addTrack(track, sourceStream);
      });
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          void postMediaSignal(
            remoteDeviceId,
            "ice",
            event.candidate.toJSON() as unknown as Record<string, unknown>,
          );
        }
      };
      peerConnection.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;
        setRemoteShareList((shares) => {
          const previous = shares.find((share) => share.deviceId === remoteDeviceId);
          if (previous?.stream !== stream) {
            stopMediaStream(previous?.stream ?? null);
          }
          return [
            { deviceId: remoteDeviceId, stream },
            ...shares.filter((share) => share.deviceId !== remoteDeviceId),
          ];
        });
      };
      peerConnectionsRef.current.set(remoteDeviceId, peerConnection);
      return peerConnection;
    },
    [getLocalTracks, postMediaSignal, setRemoteShareList],
  );

  const closePeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((peerConnection) => peerConnection.close());
    peerConnectionsRef.current.clear();
    setRemoteShareList(() => []);
  }, [setRemoteShareList]);

  const createOfferForDevice = useCallback(
    async (remoteDeviceId: string) => {
      const peerConnection = ensurePeerConnection(remoteDeviceId);
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await postMediaSignal(remoteDeviceId, "offer", offer as unknown as Record<string, unknown>);
    },
    [ensurePeerConnection, postMediaSignal],
  );

  const handleMediaSignal = useCallback(
    async (signal: CollaborationMediaSignal) => {
      if (signal.kind === "leave") {
        const peerConnection = peerConnectionsRef.current.get(signal.senderDeviceId);
        peerConnection?.close();
        peerConnectionsRef.current.delete(signal.senderDeviceId);
        setRemoteShareList((shares) =>
          shares.filter((share) => share.deviceId !== signal.senderDeviceId),
        );
        return;
      }

      const peerConnection = ensurePeerConnection(signal.senderDeviceId);
      if (signal.kind === "offer") {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(signal.payload as unknown as RTCSessionDescriptionInit),
        );
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await postMediaSignal(
          signal.senderDeviceId,
          "answer",
          answer as unknown as Record<string, unknown>,
        );
        return;
      }

      if (signal.kind === "answer") {
        await peerConnection.setRemoteDescription(
          new RTCSessionDescription(signal.payload as unknown as RTCSessionDescriptionInit),
        );
        return;
      }

      if (signal.kind === "ice") {
        await peerConnection.addIceCandidate(
          new RTCIceCandidate(signal.payload as unknown as RTCIceCandidateInit),
        );
      }
    },
    [ensurePeerConnection, postMediaSignal, setRemoteShareList],
  );

  useEffect(() => {
    if (!selectedChannel) return;

    let cancelled = false;
    const pollSignals = async () => {
      try {
        const signals = await fetchCollaborationMediaSignals({
          channelId: selectedChannel.id,
          afterId: lastMediaSignalIdRef.current,
          deviceId: getLocalDeviceId(),
        });
        for (const signal of signals) {
          lastMediaSignalIdRef.current = Math.max(lastMediaSignalIdRef.current, signal.id);
          if (!cancelled) await handleMediaSignal(signal);
        }
      } catch {
        if (import.meta.env.DEV) console.debug("Collaboration media signal poll failed");
      }
    };

    void pollSignals();
    const timer = window.setInterval(() => void pollSignals(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [getLocalDeviceId, handleMediaSignal, selectedChannel]);

  useEffect(() => {
    if (!selectedChannel) return;
    const hasLocalTracks = mediaState.microphone || mediaState.screen;

    closePeerConnections();
    if (!hasLocalTracks) {
      void postMediaSignal(null, "leave", {});
      return;
    }

    for (const remoteDeviceId of remoteDeviceIds) {
      void createOfferForDevice(remoteDeviceId);
    }
  }, [
    closePeerConnections,
    createOfferForDevice,
    mediaState.microphone,
    mediaState.screen,
    postMediaSignal,
    remoteDeviceIds,
    selectedChannel,
  ]);

  if (!model) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-primary-bg">
        <div className="border-border/70 border-b px-3 py-2">
          <div className="ui-font flex items-center gap-2 text-text text-sm">
            <UsersThree weight="duotone" />
            Collaboration
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-5 text-center text-text-lighter text-xs">
          Teams workspace is not available for this account.
        </div>
      </div>
    );
  }

  const streamTone =
    activeDocumentStream.status === "live"
      ? "text-accent"
      : activeDocumentStream.status === "error"
        ? "text-error"
        : "text-text-lighter";

  const sendMessage = async () => {
    if (!selectedChannel || !model.canEditNotes || !draft.trim()) return;

    setIsSending(true);
    setSendError(null);
    try {
      const nextCollaboration = await updateCollaborationChannelNote({
        channelId: selectedChannel.id,
        contentMarkdown: appendCollaborationChatMessage({
          contentMarkdown: selectedNoteContent,
          author: user?.name || user?.email || "Member",
          message: draft,
        }),
      });
      setCollaborationSnapshot(nextCollaboration);
      setDraft("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Message failed");
    } finally {
      setIsSending(false);
    }
  };

  const updateNote = async (contentMarkdown: string, errorMessage: string) => {
    if (!selectedChannel || !model.canEditNotes) return false;

    setIsSending(true);
    setSendError(null);
    try {
      const nextCollaboration = await updateCollaborationChannelNote({
        channelId: selectedChannel.id,
        contentMarkdown,
      });
      setCollaborationSnapshot(nextCollaboration);
      return true;
    } catch (error) {
      setSendError(error instanceof Error ? error.message : errorMessage);
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const toggleMic = async () => {
    if (micStreamRef.current) {
      stopMediaStream(micStreamRef.current);
      micStreamRef.current = null;
      setMicState("idle");
      collaborationActions.setMicrophoneActive(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      setMicState("active");
      collaborationActions.setMicrophoneActive(true);
    } catch (error) {
      setMicState("error");
      const detail =
        error instanceof DOMException
          ? `${error.name}: ${error.message}`
          : error instanceof Error
            ? error.message
            : "Unknown error";
      console.error("Microphone access failed", error);
      toast.error(`Microphone access failed: ${detail}`);
    }
  };

  const toggleScreenShare = async () => {
    if (screenStreamRef.current) {
      stopMediaStream(screenStreamRef.current);
      screenStreamRef.current = null;
      setScreenState("idle");
      collaborationActions.setScreenShareActive(false);
      return;
    }

    const getDisplayMedia = navigator.mediaDevices.getDisplayMedia;
    if (!getDisplayMedia) {
      setScreenState("error");
      toast.error("Screen sharing is unavailable in this webview.");
      return;
    }

    try {
      const stream = await getDisplayMedia.call(navigator.mediaDevices, {
        video: true,
        audio: false,
      });
      screenStreamRef.current = stream;
      setScreenState("active");
      collaborationActions.setScreenShareActive(true);
      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          stopMediaStream(stream);
          screenStreamRef.current = null;
          setScreenState("idle");
          collaborationActions.setScreenShareActive(false);
        },
        { once: true },
      );
    } catch (error) {
      setScreenState("error");
      const detail =
        error instanceof DOMException
          ? `${error.name}: ${error.message}`
          : error instanceof Error
            ? error.message
            : "Unknown error";
      console.error("Screen sharing failed", error);
      toast.error(`Screen sharing failed: ${detail}`);
    }
  };

  const shareDocuments = async () => {
    if (!selectedChannel || !model.canEditNotes) return;

    const selected = await open({
      multiple: true,
      directory: false,
      title: "Share Documents",
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length === 0) return;

    const names = paths.map((path) => getBaseName(path, path));
    const saved = await updateNote(
      appendCollaborationSharedDocuments({
        contentMarkdown: selectedNoteContent,
        author: user?.name || user?.email || "Member",
        documentNames: names,
      }),
      "Document share failed",
    );
    if (saved) toast.success(`${names.length} document${names.length === 1 ? "" : "s"} shared.`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <div className={paneHeaderClassName("relative z-[10020]")}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="ui-font flex min-w-0 items-center gap-2 text-text text-sm">
              <span className={cn(PANE_CHIP_BASE, "size-6 justify-center px-0")}>
                <UsersThree className="size-3.5" weight="duotone" />
              </span>
              <span className="truncate text-xs font-medium">{model.workspaceName}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 pl-8 text-text-lighter text-[11px]">
              <span>{model.onlineCount} online</span>
              <span>/</span>
              <span className={cn("truncate", streamTone)}>{activeDocumentStream.status}</span>
            </div>
          </div>
          <PaneIconButton
            type="button"
            tooltip="Collaboration Settings"
            tooltipSide="bottom"
            onClick={() => openSettingsDialog("collaboration")}
          >
            <GearSix />
          </PaneIconButton>
        </div>
      </div>

      <div className="border-border/60 border-b px-2 py-1.5">
        <div className="flex gap-1 overflow-x-auto">
          {model.channels.map((channel) => (
            <Button
              key={channel.id}
              type="button"
              variant="secondary"
              size="xs"
              active={selectedChannel?.id === channel.id}
              className="h-6 max-w-[120px] rounded-lg border-border/60 bg-transparent px-2 text-xs"
              disabled={!collaboration?.capabilities.presence}
              onClick={() => collaborationActions.setPresenceChannel(channel.id)}
            >
              <span className="truncate">#{channel.slug}</span>
            </Button>
          ))}
        </div>
        {model.participants.length > 0 ? (
          <div className="mt-1.5 flex items-center gap-1 overflow-x-auto">
            {model.participants.slice(0, 8).map((participant) => (
              <button
                key={participant.id}
                type="button"
                className={cn(
                  "flex h-6 max-w-[112px] items-center gap-1 rounded-lg border border-border/50 bg-secondary-bg/35 px-1.5 text-left text-[11px] text-text-lighter",
                  participant.online && "text-text",
                  presenceTarget.followingUserId === participant.followableUserId && "bg-hover",
                )}
                disabled={
                  !participant.followableUserId || participant.followableUserId === user?.id
                }
                onClick={() =>
                  participant.followableUserId &&
                  collaborationActions.setFollowingUser(participant.followableUserId)
                }
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full bg-text-lighter/50",
                    participant.online && "bg-accent",
                  )}
                />
                <span className="min-w-0 truncate">{participant.name}</span>
                {participant.microphone ? <Mic className="size-3 shrink-0" /> : null}
                {participant.screen ? <Monitor className="size-3 shrink-0" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {remoteShares.length > 0 ? (
          <section className="space-y-1.5">
            {remoteShares.map((share) => (
              <RemoteMediaTile key={share.deviceId} share={share} />
            ))}
          </section>
        ) : null}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="ui-font flex items-center gap-1.5 text-text-light text-xs">
              <ChatCircleText className="size-4" weight="duotone" />
              Chat
            </div>
            {selectedChannel ? (
              <span className={paneChipClassName("max-w-[120px] truncate")}>
                #{selectedChannel.slug}
              </span>
            ) : null}
          </div>

          <div className="space-y-1.5">
            {model.chatGroups.length > 0 ? (
              model.chatGroups.slice(-10).map((group) => (
                <div key={group.id} className="space-y-1">
                  <div className="px-1 text-text-lighter text-[11px]">{group.author}</div>
                  <div className="space-y-px">
                    {group.entries.map((entry, index) => (
                      <div
                        key={entry.id}
                        className={cn(
                          "border border-border/45 bg-secondary-bg/45 px-2.5 py-1.5 text-text text-xs leading-5",
                          index === 0 && "rounded-t-lg",
                          index === group.entries.length - 1 && "rounded-b-lg",
                          group.entries.length === 1 && "rounded-lg",
                        )}
                      >
                        {entry.kind === "document" ? (
                          <span className="mb-0.5 flex items-center gap-1.5 text-text-lighter text-[11px]">
                            <FileText className="size-3" weight="duotone" />
                            Document
                          </span>
                        ) : null}
                        {entry.body}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-border/60 border-dashed px-2 py-3 text-center text-text-lighter text-xs">
                No messages yet.
              </div>
            )}
          </div>
        </section>

        <div className="rounded-lg border border-border/50 bg-secondary-bg/30 px-2 py-1.5 text-text-lighter text-[11px]">
          {model.participants.length} members · {model.onlineCount} online
          {mediaState.microphone || mediaState.screen ? (
            <span>
              {" "}
              · sharing {mediaState.microphone ? "mic" : ""}
              {mediaState.microphone && mediaState.screen ? " + " : ""}
              {mediaState.screen ? "screen" : ""}
            </span>
          ) : null}
        </div>
      </div>

      <div className="border-border/70 border-t p-2">
        {sendError ? <div className="mb-1.5 text-error text-xs">{sendError}</div> : null}
        <div className="rounded-xl border border-border/70 bg-primary-bg/92 p-1.5 shadow-sm">
          <Textarea
            value={draft}
            variant="ghost"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder={model.canEditNotes ? "Message channel" : "Read only"}
            disabled={!selectedChannel || !model.canEditNotes || isSending}
            className="max-h-24 min-h-12 resize-none px-2 py-1.5 text-xs leading-5"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                active={micState === "active"}
                className={chatComposerIconButtonClassName(
                  micState === "error" ? "text-error hover:text-error" : undefined,
                )}
                tooltip={micState === "active" ? "Stop Mic" : "Start Mic"}
                tooltipSide="top"
                onClick={() => void toggleMic()}
              >
                <Mic />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                active={screenState === "active"}
                className={chatComposerIconButtonClassName(
                  screenState === "error" ? "text-error hover:text-error" : undefined,
                )}
                tooltip={screenState === "active" ? "Stop Screen Share" : "Share Screen"}
                tooltipSide="top"
                onClick={() => void toggleScreenShare()}
              >
                <Monitor />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={chatComposerIconButtonClassName()}
                disabled={!selectedChannel || !model.canEditNotes || isSending}
                tooltip="Share Documents"
                tooltipSide="top"
                onClick={() => void shareDocuments()}
              >
                <FilePlus />
              </Button>
            </div>
            <Button
              type="button"
              variant="primary"
              size="icon-sm"
              className="size-6 rounded-md p-0 [&_svg]:size-3.5"
              disabled={!draft.trim() || !selectedChannel || !model.canEditNotes || isSending}
              tooltip={isSending ? "Sending" : "Send"}
              tooltipSide="top"
              onClick={() => void sendMessage()}
            >
              {isSending ? <ArrowClockwise className="animate-spin" /> : <PaperPlaneTilt />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
