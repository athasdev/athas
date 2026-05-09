import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowClockwise,
  CaretLeft,
  ChatCircleText,
  Code,
  FilePlus,
  FileText,
  Folder,
  GearSix,
  Hash,
  Lightning,
  LockKey,
  Megaphone,
  Microphone as Mic,
  Monitor,
  PaperPlaneTilt,
  PushPin,
  RocketLaunch,
  MagnifyingGlass as Search,
  UsersThree,
  Wrench,
} from "@phosphor-icons/react";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  addCollaborationNoteFile,
  addCollaborationNoteFolder,
  appendCollaborationChatMessage,
  appendCollaborationSharedDocuments,
  buildCollaborationNoteBufferPath,
  buildCollaborationSidebarModel,
  deleteCollaborationNoteItem,
  renameCollaborationNoteItem,
} from "@/features/collaboration/lib/collaboration-sidebar-model";
import { chatComposerIconButtonClassName } from "@/features/ai/components/input/chat-composer-control-styles";
import { useCollaborationRuntimeStore } from "@/features/collaboration/stores/collaboration-runtime-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import {
  appendCollaborationPrivateChatMessage,
  createCollaborationChannel,
  fetchCollaborationMediaSignals,
  getCollaborationClientId,
  postCollaborationMediaSignal,
  updateCollaborationChannelNote,
  type CollaborationMediaSignal,
} from "@/features/window/services/auth-api";
import { useAuthStore } from "@/features/window/stores/auth-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown } from "@/ui/dropdown";
import Input from "@/ui/input";
import { PaneIconButton, paneHeaderClassName } from "@/ui/pane";
import { SidebarHeader, SidebarHeaderSearch } from "@/ui/sidebar";
import {
  EQUAL_WIDTH_SEGMENTED_TAB_ITEM_CLASS_NAME,
  EQUAL_WIDTH_SEGMENTED_TABS_CLASS_NAME,
  Tabs,
} from "@/ui/tabs";
import Textarea from "@/ui/textarea";
import Tooltip from "@/ui/tooltip";
import { toast } from "@/ui/toast";
import { cn } from "@/utils/cn";
import { getBaseName } from "@/utils/path-helpers";

type ShareState = "idle" | "active" | "error";
type CollaborationSidebarTab = "channels" | "people" | "notes";
type CollaborationConversation =
  | { type: "channel"; id: number }
  | { type: "private"; participantId: string };
type SidebarChannel = NonNullable<
  ReturnType<typeof buildCollaborationSidebarModel>
>["channels"][number];
type SidebarParticipant = NonNullable<
  ReturnType<typeof buildCollaborationSidebarModel>
>["participants"][number];
type SidebarNoteItem = NonNullable<
  ReturnType<typeof buildCollaborationSidebarModel>
>["notesItems"][number];

const CHANNEL_ICON_STORAGE_KEY = "athas.collaboration.channel-icons";
const CHANNEL_EMOJI_OPTIONS = [
  "💬",
  "🛠️",
  "🚀",
  "🧪",
  "📣",
  "🔒",
  "📌",
  "⚡",
  "✅",
  "🔥",
  "🎯",
  "🧠",
];
const CHANNEL_SYMBOL_OPTIONS = [
  { id: "hash", label: "Channel", icon: Hash },
  { id: "chat", label: "Chat", icon: ChatCircleText },
  { id: "wrench", label: "Tools", icon: Wrench },
  { id: "rocket", label: "Launch", icon: RocketLaunch },
  { id: "code", label: "Code", icon: Code },
  { id: "megaphone", label: "Announce", icon: Megaphone },
  { id: "lock", label: "Private", icon: LockKey },
  { id: "pin", label: "Pinned", icon: PushPin },
  { id: "lightning", label: "Fast", icon: Lightning },
];

function loadChannelIcons() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CHANNEL_ICON_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveChannelIcons(icons: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CHANNEL_ICON_STORAGE_KEY, JSON.stringify(icons));
}

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

function getProfileInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

function ProfilePicture({ name, online }: { name: string; online?: boolean }) {
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

function StatusDot({ online }: { online: boolean }) {
  return (
    <Tooltip content={online ? "Online" : "Offline"} side="top">
      <span className={cn("block size-2 rounded-full bg-text-lighter/55", online && "bg-accent")} />
    </Tooltip>
  );
}

function renderChannelIcon(value: string | undefined) {
  if (!value) return <Hash className="size-3.5 text-text-lighter" weight="duotone" />;
  if (!value.startsWith("icon:")) return value;

  const symbol = CHANNEL_SYMBOL_OPTIONS.find((option) => option.id === value.slice(5));
  const Icon = symbol?.icon ?? Hash;
  return <Icon className="size-3.5" weight="duotone" />;
}

function ChannelIconPicker({
  selected,
  activeTab,
  onTabChange,
  onSelect,
  onClear,
}: {
  selected: string | undefined;
  activeTab: "emoji" | "icon";
  onTabChange: (tab: "emoji" | "icon") => void;
  onSelect: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="w-60 p-1">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-primary-bg/70 p-1">
        {(["emoji", "icon"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "h-7 rounded-md text-xs capitalize text-text-lighter hover:bg-hover hover:text-text",
              activeTab === tab && "bg-hover text-text",
            )}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-6 gap-1">
        {activeTab === "emoji"
          ? CHANNEL_EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-base hover:bg-hover",
                  selected === emoji && "bg-hover",
                )}
                onClick={() => onSelect(emoji)}
              >
                {emoji}
              </button>
            ))
          : CHANNEL_SYMBOL_OPTIONS.map((option) => {
              const Icon = option.icon;
              const value = `icon:${option.id}`;
              return (
                <Tooltip key={option.id} content={option.label} side="top">
                  <button
                    type="button"
                    className={cn(
                      "flex size-8 items-center justify-center rounded-md text-text-lighter hover:bg-hover hover:text-text",
                      selected === value && "bg-hover text-text",
                    )}
                    onClick={() => onSelect(value)}
                  >
                    <Icon className="size-4" weight="duotone" />
                  </button>
                </Tooltip>
              );
            })}
      </div>

      <button
        type="button"
        className="mt-2 h-7 w-full rounded-md text-center text-text-lighter text-xs hover:bg-hover hover:text-text"
        onClick={onClear}
      >
        Reset to default
      </button>
    </div>
  );
}

function SidebarHoverCard({ children, card }: { children: ReactNode; card: ReactNode }) {
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

function normalizeSearchQuery(query: string) {
  return query.trim().toLowerCase();
}

function matchesSearchQuery(
  query: string,
  values: Array<string | number | boolean | null | undefined>,
) {
  if (!query) return true;
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(query),
  );
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
  const openBuffer = useBufferStore.use.actions().openBuffer;
  const setActiveBuffer = useBufferStore.use.actions().setActiveBuffer;
  const [activeTab, setActiveTab] = useState<CollaborationSidebarTab>("channels");
  const [openConversation, setOpenConversation] = useState<CollaborationConversation | null>(null);
  const [channelSearchQuery, setChannelSearchQuery] = useState("");
  const [peopleSearchQuery, setPeopleSearchQuery] = useState("");
  const [notesSearchQuery, setNotesSearchQuery] = useState("");
  const [channelIconPickerTab, setChannelIconPickerTab] = useState<"emoji" | "icon">("emoji");
  const [channelIcons, setChannelIcons] = useState<Record<string, string>>(loadChannelIcons);
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedNotePath, setSelectedNotePath] = useState<string | null>(null);
  const [selectedNoteFolderPath, setSelectedNoteFolderPath] = useState<string | null>(null);
  const [selectedNoteItemType, setSelectedNoteItemType] = useState<"file" | "folder">("file");
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
  const channelContextMenu = useContextMenu<SidebarChannel>();
  const channelsContextMenu = useContextMenu<SidebarChannel>();
  const participantContextMenu = useContextMenu<SidebarParticipant>();
  const notesContextMenu = useContextMenu<SidebarNoteItem>();
  const deferredChannelSearchQuery = useDeferredValue(channelSearchQuery);
  const deferredPeopleSearchQuery = useDeferredValue(peopleSearchQuery);
  const deferredNotesSearchQuery = useDeferredValue(notesSearchQuery);

  const model = useMemo(
    () =>
      buildCollaborationSidebarModel({
        collaboration,
        selectedChannelId: presenceTarget.channelId,
      }),
    [collaboration, presenceTarget.channelId],
  );
  const selectedChannel = model?.selectedChannel ?? null;
  const openChannel =
    openConversation?.type === "channel"
      ? (model?.channels.find((channel) => channel.id === openConversation.id) ?? selectedChannel)
      : selectedChannel;
  const openPrivateParticipant =
    openConversation?.type === "private"
      ? (model?.participants.find(
          (participant) => participant.id === openConversation.participantId,
        ) ?? null)
      : null;
  const privateChatEntries =
    openPrivateParticipant && collaboration?.privateChats
      ? collaboration.privateChats.filter(
          (entry) => entry.conversationMemberId === Number(openPrivateParticipant.id),
        )
      : [];
  const selectedNoteContent = model?.selectedNote?.contentMarkdown ?? "";
  const noteFiles = useMemo(
    () => model?.notesItems.filter((item) => item.type === "file") ?? [],
    [model?.notesItems],
  );
  const selectedNoteFile =
    noteFiles.find((item) => item.path === selectedNotePath) ?? noteFiles[0] ?? null;
  const selectedNoteFolder =
    model?.notesItems.find(
      (item) => item.type === "folder" && item.path === selectedNoteFolderPath,
    ) ?? null;
  const channelSearch = normalizeSearchQuery(deferredChannelSearchQuery);
  const peopleSearch = normalizeSearchQuery(deferredPeopleSearchQuery);
  const notesSearch = normalizeSearchQuery(deferredNotesSearchQuery);
  const filteredChannels = useMemo(() => {
    const channels = model?.channels ?? [];
    if (!channelSearch) return channels;

    return channels.filter((channel) =>
      matchesSearchQuery(channelSearch, [
        channel.slug,
        channel.description,
        channel.memberCount,
        channel.id,
      ]),
    );
  }, [channelSearch, model?.channels]);
  const filteredParticipants = useMemo(() => {
    const participants = model?.participants ?? [];
    if (!peopleSearch) return participants;

    return participants.filter((participant) =>
      matchesSearchQuery(peopleSearch, [
        participant.name,
        participant.role,
        participant.activeFilePath,
        participant.online ? "online" : "offline",
        participant.microphone ? "microphone" : null,
        participant.screen ? "screen" : null,
      ]),
    );
  }, [model?.participants, peopleSearch]);
  const filteredPrivateChatParticipants = useMemo(() => {
    const participants = model?.participants ?? [];
    if (!channelSearch) return participants;

    return participants.filter((participant) =>
      matchesSearchQuery(channelSearch, [
        participant.name,
        participant.role,
        participant.online ? "online" : "offline",
        participant.activeFilePath,
      ]),
    );
  }, [channelSearch, model?.participants]);
  const filteredNoteItems = useMemo(() => {
    const items = model?.notesItems ?? [];
    if (!notesSearch) return items;

    return items.filter((item) =>
      matchesSearchQuery(notesSearch, [
        item.path,
        item.type,
        item.type === "file" ? item.content : null,
      ]),
    );
  }, [model?.notesItems, notesSearch]);
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
  const hasLocalMedia = mediaState.microphone || mediaState.screen;
  const hasRemoteMedia = useMemo(() => {
    if (!selectedChannel || !collaboration?.presence) return false;
    const localDeviceId = localDeviceIdRef.current ?? getCollaborationClientId();
    localDeviceIdRef.current = localDeviceId;
    return collaboration.presence.some(
      (presence) =>
        presence.status === "online" &&
        presence.channelId === selectedChannel.id &&
        presence.deviceId !== localDeviceId &&
        /\b(?:mic|screen)\b/.test(presence.cursorLabel ?? ""),
    );
  }, [collaboration?.presence, selectedChannel]);
  const shouldPollMediaSignals = Boolean(selectedChannel && (hasLocalMedia || hasRemoteMedia));

  useEffect(() => {
    if (!selectedNoteFile) {
      setSelectedNotePath(null);
      setSelectedNoteFolderPath(null);
      return;
    }

    setSelectedNotePath(selectedNoteFile.path);
    setSelectedNoteItemType("file");
    setSelectedNoteFolderPath(selectedNoteFile.path.split("/").slice(0, -1).join("/") || null);
  }, [selectedNoteFile, selectedChannel?.id]);

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

  useEffect(() => {
    if (shouldPollMediaSignals) return;
    closePeerConnections();
  }, [closePeerConnections, shouldPollMediaSignals]);

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
    if (!selectedChannel || !shouldPollMediaSignals) return;

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
  }, [getLocalDeviceId, handleMediaSignal, selectedChannel, shouldPollMediaSignals]);

  useEffect(() => {
    if (!selectedChannel) return;

    closePeerConnections();
    if (!hasLocalMedia) {
      void postMediaSignal(null, "leave", {});
      return;
    }

    for (const remoteDeviceId of remoteDeviceIds) {
      void createOfferForDevice(remoteDeviceId);
    }
  }, [
    closePeerConnections,
    createOfferForDevice,
    hasLocalMedia,
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

  const sendPrivateMessage = async () => {
    if (!openPrivateParticipant || !model.canEditNotes || !draft.trim()) return;

    setIsSending(true);
    setSendError(null);
    try {
      const nextCollaboration = await appendCollaborationPrivateChatMessage({
        memberId: Number(openPrivateParticipant.id),
        body: draft,
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

  const beginCreateChannel = () => {
    if (!collaboration?.capabilities.canCreateChannels) return;
    setActiveTab("channels");
    setOpenConversation(null);
    setIsCreatingChannel(true);
    setNewChannelName("");
  };

  const createChannel = async (name: string) => {
    if (!collaboration?.capabilities.canCreateChannels) return;
    const cleanName = name.trim();
    if (!cleanName) return;

    setIsSending(true);
    setSendError(null);
    try {
      const previousIds = new Set(model.channels.map((channel) => channel.id));
      const nextCollaboration = await createCollaborationChannel({ name: cleanName });
      setCollaborationSnapshot(nextCollaboration);
      setIsCreatingChannel(false);
      setNewChannelName("");
      const createdChannel = nextCollaboration?.channels.find(
        (channel) => !previousIds.has(channel.id),
      );
      if (createdChannel) openChannelChat(createdChannel.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Channel creation failed";
      setSendError(message);
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  };

  const openParticipantFile = async (path: string) => {
    try {
      const content = await readFileContent(path);
      const bufferId = openBuffer(path, getBaseName(path, path), content);
      setActiveBuffer(bufferId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to open collaborator file.");
    }
  };

  const openNoteFileInEditor = (noteFile: typeof selectedNoteFile) => {
    if (!selectedChannel || !noteFile) return;

    const path = buildCollaborationNoteBufferPath(selectedChannel.id, noteFile.path);
    const bufferId = openBuffer(
      path,
      noteFile.path.split("/").slice(-1)[0] ?? "notes.md",
      noteFile.content,
      false,
      undefined,
      false,
      true,
    );
    setActiveBuffer(bufferId);
  };

  const createNoteFile = async (folderPath?: string | null) => {
    if (!selectedChannel || !model.canEditNotes) return;
    const path = window.prompt(
      "Markdown file name",
      folderPath ? `${folderPath}/notes.md` : "notes.md",
    );
    if (!path?.trim()) return;

    const next = addCollaborationNoteFile({
      contentMarkdown: selectedNoteContent,
      path: path.trim(),
      folderPath,
    });
    const saved = await updateNote(next.contentMarkdown, "File creation failed");
    if (!saved) return;
    const file = { type: "file" as const, path: next.path, content: "" };
    setSelectedNoteItemType("file");
    setSelectedNotePath(next.path);
    openNoteFileInEditor(file);
  };

  const createNoteFolder = async () => {
    if (!selectedChannel || !model.canEditNotes) return;
    const path = window.prompt("Folder name", selectedNoteFolder?.path ?? "Notes");
    if (!path?.trim()) return;

    const next = addCollaborationNoteFolder({
      contentMarkdown: selectedNoteContent,
      path: path.trim(),
    });
    const saved = await updateNote(next.contentMarkdown, "Folder creation failed");
    if (!saved) return;
    setSelectedNoteItemType("folder");
    setSelectedNoteFolderPath(next.path);
  };

  const renameNoteItem = async (item: SidebarNoteItem) => {
    if (!selectedChannel || !model.canEditNotes) return;
    const nextPath = window.prompt("Rename", item.path);
    if (!nextPath?.trim() || nextPath.trim() === item.path) return;

    const next = renameCollaborationNoteItem({
      contentMarkdown: selectedNoteContent,
      type: item.type,
      path: item.path,
      nextPath: nextPath.trim(),
    });
    const saved = await updateNote(next.contentMarkdown, "Rename failed");
    if (!saved) return;
    if (item.type === "file") {
      setSelectedNoteItemType("file");
      setSelectedNotePath(next.path);
    } else {
      setSelectedNoteItemType("folder");
      setSelectedNoteFolderPath(next.path);
    }
  };

  const deleteNoteItem = async (item: SidebarNoteItem) => {
    if (!selectedChannel || !model.canEditNotes) return;
    if (!window.confirm(`Delete ${item.path}?`)) return;

    const nextContent = deleteCollaborationNoteItem({
      contentMarkdown: selectedNoteContent,
      type: item.type,
      path: item.path,
    });
    await updateNote(nextContent, "Delete failed");
  };

  const openChannelChat = (channelId: number) => {
    collaborationActions.setPresenceChannel(channelId);
    setDraft("");
    setSendError(null);
    setOpenConversation({ type: "channel", id: channelId });
  };

  const openPrivateChat = (participantId: string) => {
    setDraft("");
    setSendError(null);
    setOpenConversation({ type: "private", participantId });
  };

  const updateChannelIcon = useCallback((channelId: number, icon: string | null) => {
    setChannelIcons((current) => {
      const next = { ...current };
      if (icon) {
        next[String(channelId)] = icon;
      } else {
        delete next[String(channelId)];
      }
      saveChannelIcons(next);
      return next;
    });
  }, []);

  const selectTab = (tab: CollaborationSidebarTab) => {
    setActiveTab(tab);
    if (tab === "channels") {
      setOpenConversation(null);
    }
  };

  const channelMenuItems = useMemo<ContextMenuItem[]>(() => {
    const channel = channelsContextMenu.data;
    return [
      ...(channel
        ? [
            {
              id: "open",
              label: "Open Channel",
              icon: <ChatCircleText />,
              onClick: () => openChannelChat(channel.id),
            },
            {
              id: "change-icon",
              label: "Change Icon",
              icon: <Hash />,
              onClick: () => channelContextMenu.openAt(channelsContextMenu.position, channel),
            },
          ]
        : []),
      {
        id: "new-channel",
        label: "New Channel",
        icon: <Hash />,
        disabled: !collaboration?.capabilities.canCreateChannels,
        onClick: beginCreateChannel,
      },
    ];
  }, [
    channelContextMenu,
    channelsContextMenu.data,
    channelsContextMenu.position,
    collaboration?.capabilities.canCreateChannels,
    beginCreateChannel,
  ]);

  const participantMenuItems = useMemo<ContextMenuItem[]>(() => {
    const participant = participantContextMenu.data;
    if (!participant) return [];

    return [
      {
        id: "message",
        label: "Message",
        icon: <ChatCircleText />,
        onClick: () => openPrivateChat(participant.id),
      },
      {
        id: "follow",
        label: "Follow",
        icon: <UsersThree />,
        disabled: !participant.followableUserId || participant.followableUserId === user?.id,
        onClick: () =>
          participant.followableUserId &&
          collaborationActions.setFollowingUser(participant.followableUserId),
      },
      {
        id: "open-file",
        label: "Open Active File",
        icon: <FileText />,
        disabled: !participant.activeFilePath,
        onClick: () =>
          participant.activeFilePath && void openParticipantFile(participant.activeFilePath),
      },
    ];
  }, [collaborationActions, participantContextMenu.data, user?.id]);

  const noteMenuItems = useMemo<ContextMenuItem[]>(() => {
    const item = notesContextMenu.data;
    return [
      {
        id: "new-file",
        label: "New Markdown File",
        icon: <FileText />,
        disabled: !model.canEditNotes,
        onClick: () => void createNoteFile(item?.type === "folder" ? item.path : null),
      },
      {
        id: "new-folder",
        label: "New Folder",
        icon: <Folder />,
        disabled: !model.canEditNotes,
        onClick: () => void createNoteFolder(),
      },
      ...(item
        ? [
            {
              id: "rename",
              label: "Rename",
              icon: <FileText />,
              disabled: !model.canEditNotes,
              onClick: () => void renameNoteItem(item),
            },
            {
              id: "delete",
              label: "Delete",
              icon: <FileText />,
              disabled: !model.canEditNotes,
              onClick: () => void deleteNoteItem(item),
            },
          ]
        : []),
    ];
  }, [model.canEditNotes, notesContextMenu.data]);

  const collaborationTabs: Array<{
    id: CollaborationSidebarTab;
    label: string;
    icon: ReactNode;
  }> = [
    {
      id: "channels",
      label: "Channels",
      icon: <ChatCircleText size={16} weight="duotone" />,
    },
    {
      id: "people",
      label: "People",
      icon: <UsersThree size={16} weight="duotone" />,
    },
    {
      id: "notes",
      label: "Notes",
      icon: <FileText size={16} weight="duotone" />,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-bg">
      <div className={paneHeaderClassName("relative z-[10020]")}>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="ui-font flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate font-medium text-text">{model.workspaceName}</span>
            <span className="text-text-lighter">·</span>
            <span className="shrink-0 text-text-lighter">{model.onlineCount} online</span>
            <span className="text-text-lighter">·</span>
            <span className={cn("shrink-0", streamTone)}>{activeDocumentStream.status}</span>
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

      <div className="px-2 py-1.5">
        <Tabs
          variant="segmented"
          size="md"
          contentLayout="stacked"
          className={EQUAL_WIDTH_SEGMENTED_TABS_CLASS_NAME}
          items={collaborationTabs.map((tab) => ({
            id: tab.id,
            isActive: activeTab === tab.id,
            onClick: () => selectTab(tab.id),
            role: "tab",
            tabIndex: 0,
            icon: <div className="relative flex items-center justify-center">{tab.icon}</div>,
            label: <span className="ui-text-sm text-center leading-none">{tab.label}</span>,
            tooltip: {
              content: tab.label,
              side: "bottom",
            },
            className: EQUAL_WIDTH_SEGMENTED_TAB_ITEM_CLASS_NAME,
          }))}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-b-xl">
        {activeTab === "channels" && openConversation === null ? (
          <div
            className="h-full overflow-y-auto px-2 py-2"
            onContextMenu={(event) => channelsContextMenu.open(event)}
          >
            <SidebarHeader>
              <SidebarHeaderSearch
                value={channelSearchQuery}
                onChange={setChannelSearchQuery}
                leftIcon={Search}
              />
            </SidebarHeader>
            <div className="space-y-px">
              {isCreatingChannel ? (
                <form
                  className="mb-1 flex h-8 items-center gap-1 rounded-md bg-hover/70 px-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createChannel(newChannelName);
                  }}
                >
                  <Hash className="size-3.5 shrink-0 text-text-lighter" weight="duotone" />
                  <Input
                    autoFocus
                    value={newChannelName}
                    variant="ghost"
                    size="xs"
                    placeholder="channel-name"
                    disabled={isSending}
                    className="h-6 min-w-0 bg-transparent text-xs"
                    onChange={(event) => setNewChannelName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setIsCreatingChannel(false);
                        setNewChannelName("");
                      }
                    }}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    disabled={!newChannelName.trim() || isSending}
                  >
                    Create
                  </Button>
                </form>
              ) : null}
              {filteredChannels.map((channel) => (
                <SidebarHoverCard
                  key={channel.id}
                  card={
                    <div className="space-y-1">
                      <div className="truncate font-medium text-text">#{channel.slug}</div>
                      <div className="text-text-lighter">{channel.memberCount} members</div>
                      {channel.description ? (
                        <div className="line-clamp-3 text-text-lighter">{channel.description}</div>
                      ) : null}
                    </div>
                  }
                >
                  <button
                    type="button"
                    className={cn(
                      "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 text-left text-xs",
                      selectedChannel?.id === channel.id
                        ? "bg-hover text-text"
                        : "text-text-lighter hover:bg-hover/70 hover:text-text",
                    )}
                    onClick={() => openChannelChat(channel.id)}
                    onContextMenu={(event) => channelsContextMenu.open(event, channel)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex size-4 shrink-0 items-center justify-center text-[13px]">
                        {renderChannelIcon(channelIcons[String(channel.id)])}
                      </span>
                      <span className="min-w-0 truncate font-medium">#{channel.slug}</span>
                    </span>
                    <Tooltip content={`${channel.memberCount} members`} side="top">
                      <span className="shrink-0 text-text-lighter text-[11px]">
                        {channel.memberCount}
                      </span>
                    </Tooltip>
                  </button>
                </SidebarHoverCard>
              ))}
              {filteredPrivateChatParticipants.length > 0 ? (
                <div className="pt-2">
                  <div className="px-2 pb-1 text-text-lighter text-[11px]">Private chats</div>
                  <div className="space-y-px">
                    {filteredPrivateChatParticipants.map((participant) => (
                      <SidebarHoverCard
                        key={participant.id}
                        card={
                          <div className="flex min-w-0 items-center gap-2">
                            <ProfilePicture name={participant.name} online={participant.online} />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-text">
                                {participant.name}
                              </div>
                              <div className="truncate text-text-lighter">
                                {participant.online ? "Online" : "Offline"}
                              </div>
                            </div>
                          </div>
                        }
                      >
                        <button
                          type="button"
                          className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-text-lighter text-xs hover:bg-hover/70 hover:text-text"
                          onClick={() => openPrivateChat(participant.id)}
                          onContextMenu={(event) => participantContextMenu.open(event, participant)}
                        >
                          <ProfilePicture name={participant.name} />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {participant.name}
                          </span>
                          <StatusDot online={participant.online} />
                        </button>
                      </SidebarHoverCard>
                    ))}
                  </div>
                </div>
              ) : null}
              {channelSearch &&
              filteredChannels.length === 0 &&
              filteredPrivateChatParticipants.length === 0 ? (
                <div className="px-2 py-3 text-center text-text-lighter text-xs">No matches.</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === "channels" && openConversation?.type === "channel" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
              <Button
                type="button"
                variant="ghost"
                className="size-7 rounded-md p-0"
                tooltip="Back to Channels"
                tooltipSide="bottom"
                onClick={() => setOpenConversation(null)}
              >
                <CaretLeft />
              </Button>
              <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                {model.channels.map((channel) => (
                  <Button
                    key={channel.id}
                    type="button"
                    variant="ghost"
                    active={openChannel?.id === channel.id}
                    className="h-7 max-w-[128px] rounded-md px-2 text-xs"
                    onClick={() => openChannelChat(channel.id)}
                    onContextMenu={(event) => channelsContextMenu.open(event, channel)}
                  >
                    <span className="shrink-0 text-[12px]">
                      {renderChannelIcon(channelIcons[String(channel.id)])}
                    </span>
                    <span className="truncate">#{channel.slug}</span>
                  </Button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-1.5">
                {model.chatGroups.length > 0 ? (
                  model.chatGroups.slice(-10).map((group) => (
                    <div key={group.id} className="flex gap-2">
                      <ProfilePicture name={group.author} />
                      <div className="min-w-0 flex-1 space-y-1">
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
                    </div>
                  ))
                ) : (
                  <div className="px-2 py-3 text-center text-text-lighter text-xs">
                    No chats yet.
                  </div>
                )}
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
                  placeholder={
                    model.canEditNotes ? `Message #${openChannel?.slug ?? "channel"}` : "Read only"
                  }
                  disabled={!selectedChannel || !model.canEditNotes || isSending}
                  className="max-h-24 min-h-12 resize-none px-2 py-1.5 text-xs leading-5"
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className={chatComposerIconButtonClassName()}
                    disabled={!selectedChannel || !model.canEditNotes || isSending}
                    tooltip="Share Documents"
                    tooltipSide="top"
                    onClick={() => void shareDocuments()}
                  >
                    <FilePlus />
                  </Button>
                  <Button
                    type="button"
                    variant="accent"
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
        ) : null}

        {activeTab === "channels" && openConversation?.type === "private" ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
              <Button
                type="button"
                variant="ghost"
                className="size-7 rounded-md p-0"
                tooltip="Back to Channels"
                tooltipSide="bottom"
                onClick={() => setOpenConversation(null)}
              >
                <CaretLeft />
              </Button>
              {openPrivateParticipant ? (
                <>
                  <ProfilePicture
                    name={openPrivateParticipant.name}
                    online={openPrivateParticipant.online}
                  />
                  <div className="min-w-0 flex-1 truncate text-text text-xs">
                    {openPrivateParticipant.name}
                  </div>
                  <StatusDot online={openPrivateParticipant.online} />
                </>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-1.5">
                {privateChatEntries.length > 0 ? (
                  privateChatEntries.map((entry) => {
                    const author = model.activeMembers.find(
                      (member) => member.id === entry.authorMemberId,
                    );
                    const authorName = author?.name ?? "Member";
                    return (
                      <div key={entry.id} className="flex gap-2">
                        <ProfilePicture name={authorName} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="px-1 text-text-lighter text-[11px]">{authorName}</div>
                          <div className="rounded-lg border border-border/45 bg-secondary-bg/45 px-2.5 py-1.5 text-text text-xs leading-5">
                            {entry.body}
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-3 text-center text-text-lighter text-xs">
                    No private messages yet.
                  </div>
                )}
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
                      void sendPrivateMessage();
                    }
                  }}
                  placeholder={
                    model.canEditNotes
                      ? `Message ${openPrivateParticipant?.name ?? "teammate"}`
                      : "Read only"
                  }
                  disabled={!openPrivateParticipant || !model.canEditNotes || isSending}
                  className="max-h-24 min-h-12 resize-none px-2 py-1.5 text-xs leading-5"
                />
                <div className="mt-1 flex justify-end">
                  <Button
                    type="button"
                    variant="accent"
                    className="size-6 rounded-md p-0 [&_svg]:size-3.5"
                    disabled={
                      !draft.trim() || !openPrivateParticipant || !model.canEditNotes || isSending
                    }
                    tooltip={isSending ? "Sending" : "Send"}
                    tooltipSide="top"
                    onClick={() => void sendPrivateMessage()}
                  >
                    {isSending ? <ArrowClockwise className="animate-spin" /> : <PaperPlaneTilt />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "people" ? (
          <div className="h-full overflow-y-auto px-2 py-2">
            <SidebarHeader>
              <SidebarHeaderSearch
                value={peopleSearchQuery}
                onChange={setPeopleSearchQuery}
                leftIcon={Search}
              />
            </SidebarHeader>
            {remoteShares.length > 0 ? (
              <div className="mb-1 space-y-1.5">
                {remoteShares.map((share) => (
                  <RemoteMediaTile key={share.deviceId} share={share} />
                ))}
              </div>
            ) : null}

            <div className="space-y-px">
              {filteredParticipants.length > 0 ? (
                filteredParticipants.map((participant) => (
                  <SidebarHoverCard
                    key={participant.id}
                    card={
                      <div className="flex min-w-0 items-center gap-2">
                        <ProfilePicture name={participant.name} online={participant.online} />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-text">{participant.name}</div>
                          <div className="truncate text-text-lighter">
                            {participant.online ? "Online" : "Offline"}
                          </div>
                          {participant.activeFilePath ? (
                            <div className="mt-1 truncate text-text-lighter">
                              {participant.activeFilePath}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    }
                  >
                    <div
                      className={cn(
                        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-text-lighter",
                        participant.online && "text-text",
                        presenceTarget.followingUserId === participant.followableUserId &&
                          "bg-hover",
                        "hover:bg-hover/70 hover:text-text",
                      )}
                      onContextMenu={(event) => participantContextMenu.open(event, participant)}
                    >
                      <ProfilePicture name={participant.name} />
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left"
                        disabled={
                          !participant.followableUserId || participant.followableUserId === user?.id
                        }
                        onClick={() =>
                          participant.followableUserId &&
                          collaborationActions.setFollowingUser(participant.followableUserId)
                        }
                      >
                        {participant.name}
                      </button>
                      <StatusDot online={participant.online} />
                      {participant.microphone ? <Mic className="size-3 shrink-0" /> : null}
                      {participant.screen ? <Monitor className="size-3 shrink-0" /> : null}
                      {participant.activeFilePath ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => void openParticipantFile(participant.activeFilePath!)}
                        >
                          Open
                        </Button>
                      ) : null}
                    </div>
                  </SidebarHoverCard>
                ))
              ) : (
                <div className="px-2 py-3 text-center text-text-lighter text-xs">
                  {peopleSearch ? "No matching members." : "No members yet."}
                </div>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "notes" ? (
          <div
            className="h-full overflow-y-auto px-2 py-2"
            onContextMenu={(event) => notesContextMenu.open(event)}
          >
            <SidebarHeader>
              <SidebarHeaderSearch
                value={notesSearchQuery}
                onChange={setNotesSearchQuery}
                leftIcon={Search}
              />
            </SidebarHeader>
            <div className="mb-1 flex justify-end px-1">
              <Button
                type="button"
                variant="ghost"
                className="h-6 shrink-0 px-2 text-xs"
                onClick={() => openSettingsDialog("collaboration")}
              >
                Secrets
              </Button>
            </div>
            <div className="space-y-px">
              {filteredNoteItems.map((item) => {
                return (
                  <button
                    key={`${item.type}:${item.path}`}
                    type="button"
                    className={cn(
                      "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-text-lighter text-xs",
                      (item.type === "file" &&
                        selectedNoteItemType === "file" &&
                        selectedNoteFile?.path === item.path) ||
                        (item.type === "folder" &&
                          selectedNoteItemType === "folder" &&
                          selectedNoteFolder?.path === item.path)
                        ? "bg-hover text-text"
                        : "hover:bg-hover/70 hover:text-text",
                    )}
                    onClick={() => {
                      if (item.type === "folder") {
                        setSelectedNoteItemType("folder");
                        setSelectedNoteFolderPath(item.path);
                        return;
                      }

                      setSelectedNoteItemType("file");
                      setSelectedNotePath(item.path);
                      setSelectedNoteFolderPath(
                        item.path.split("/").slice(0, -1).join("/") || null,
                      );
                      openNoteFileInEditor(item);
                    }}
                    onContextMenu={(event) => notesContextMenu.open(event, item)}
                  >
                    {item.type === "folder" ? (
                      <Folder className="size-3.5 shrink-0" weight="duotone" />
                    ) : (
                      <FileText className="size-3.5 shrink-0" weight="duotone" />
                    )}
                    <span
                      className="min-w-0 truncate"
                      style={{
                        paddingLeft: `${Math.max(item.path.split("/").length - 1, 0) * 10}px`,
                      }}
                    >
                      {item.path.split("/").slice(-1)[0]}
                    </span>
                  </button>
                );
              })}
              {filteredNoteItems.length === 0 ? (
                <div className="px-2 py-3 text-center text-text-lighter text-xs">
                  No matching notes.
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-border/70 border-t bg-secondary-bg/35 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
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
          <span className="min-w-0 truncate text-text-lighter text-[11px]">
            {model.onlineCount} online · {activeDocumentStream.status}
          </span>
          {presenceTarget.followingUserId ? (
            <Button
              type="button"
              variant="ghost"
              className="ml-auto h-6 px-2 text-[11px]"
              onClick={() => collaborationActions.setFollowingUser(null)}
            >
              Stop
            </Button>
          ) : null}
        </div>
      </div>

      <ContextMenu
        isOpen={channelsContextMenu.isOpen}
        position={channelsContextMenu.position}
        items={channelMenuItems}
        onClose={channelsContextMenu.close}
      />
      <ContextMenu
        isOpen={participantContextMenu.isOpen}
        position={participantContextMenu.position}
        items={participantMenuItems}
        onClose={participantContextMenu.close}
      />
      <ContextMenu
        isOpen={notesContextMenu.isOpen}
        position={notesContextMenu.position}
        items={noteMenuItems}
        onClose={notesContextMenu.close}
      />

      <Dropdown
        isOpen={channelContextMenu.isOpen}
        point={channelContextMenu.position}
        onClose={channelContextMenu.close}
        className="min-w-0 p-1"
        style={{ width: 256 }}
      >
        {channelContextMenu.data ? (
          <ChannelIconPicker
            selected={channelIcons[String(channelContextMenu.data.id)]}
            activeTab={channelIconPickerTab}
            onTabChange={setChannelIconPickerTab}
            onSelect={(value) => {
              if (!channelContextMenu.data) return;
              updateChannelIcon(channelContextMenu.data.id, value);
              channelContextMenu.close();
            }}
            onClear={() => {
              if (!channelContextMenu.data) return;
              updateChannelIcon(channelContextMenu.data.id, null);
              channelContextMenu.close();
            }}
          />
        ) : null}
      </Dropdown>
    </div>
  );
}
