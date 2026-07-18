import { open } from "@tauri-apps/plugin-dialog";
import {
  CaretLeftIcon as CaretLeft,
  CheckIcon as Check,
  ChatCircleTextIcon as ChatCircleText,
  FileTextIcon as FileText,
  FolderIcon as Folder,
  HashIcon as Hash,
  MicrophoneIcon as Mic,
  MonitorIcon as Monitor,
  MagnifyingGlassIcon as Search,
  UsersThreeIcon as UsersThree,
} from "@/ui/icons";
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { useCollaborationRuntimeStore } from "@/features/collaboration/stores/collaboration-runtime.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
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
import { useAuthStore } from "@/features/window/stores/auth.store";
import { Button } from "@/ui/button";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import Input from "@/ui/input";
import {
  SidebarEmptyActionState,
  SidebarHeader,
  SidebarListItem,
  SidebarPanel,
  SidebarSearchFilterRow,
  SidebarSectionHeader,
  SidebarSectionPager,
  SidebarSectionSwitcher,
} from "@/ui/sidebar";
import { toast } from "@/ui/toast";
import Tooltip from "@/ui/tooltip";
import { cn } from "@/utils/cn";
import { getBaseName } from "@/utils/path-helpers";
import {
  ChannelIconPicker,
  loadChannelIcons,
  renderChannelIcon,
  saveChannelIcons,
} from "./collaboration-channel-icons";
import { CollaborationAvatar, PresenceStatusDot } from "./collaboration-avatar";
import { CollaborationMediaFooter } from "./collaboration-media-footer";
import { CollaborationMessageComposer } from "./collaboration-message-composer";
import { RemoteMediaTile, type RemoteMediaShare } from "./collaboration-remote-media-tile";

type ShareState = "idle" | "active" | "error";
type CollaborationSidebarTab = "channels" | "people" | "notes";
type CollaborationChannelFilter = "all" | "active" | "with-guests" | "empty";
type CollaborationPeopleFilter = "all" | "online" | "offline" | "sharing" | "has-file";
type CollaborationNotesFilter = "notes" | "secrets" | "all";
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
type CollaborationFilterOption<T extends string> = {
  id: T;
  label: string;
};

const COLLABORATION_TABS: Array<{
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

const CHANNEL_FILTER_OPTIONS: Array<CollaborationFilterOption<CollaborationChannelFilter>> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "with-guests", label: "With guests" },
  { id: "empty", label: "Empty" },
];

const PEOPLE_FILTER_OPTIONS: Array<CollaborationFilterOption<CollaborationPeopleFilter>> = [
  { id: "all", label: "All" },
  { id: "online", label: "Online" },
  { id: "offline", label: "Offline" },
  { id: "sharing", label: "Sharing" },
  { id: "has-file", label: "Has file" },
];

const NOTE_FILTER_OPTIONS: Array<CollaborationFilterOption<CollaborationNotesFilter>> = [
  { id: "notes", label: "Notes" },
  { id: "secrets", label: "Secrets" },
  { id: "all", label: "All" },
];

function createCollaborationFilterMenuItems<T extends string>({
  activeId,
  onClose,
  onSelect,
  options,
}: {
  activeId: T;
  onClose: () => void;
  onSelect: (id: T) => void;
  options: Array<CollaborationFilterOption<T>>;
}): MenuItem[] {
  return options.map((item) => ({
    id: item.id,
    label: item.label,
    keybinding: activeId === item.id ? <Check className="size-3.5 text-accent" /> : null,
    onClick: () => {
      onSelect(item.id);
      onClose();
    },
  }));
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => {
    if (track.readyState !== "ended") {
      track.stop();
    }
  });
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

export function CollaborationSidebarView() {
  const user = useAuthStore((state) => state.user);
  const collaboration = useAuthStore((state) => state.subscription?.collaboration);
  const setCollaborationSnapshot = useAuthStore((state) => state.setCollaborationSnapshot);
  const presenceTarget = useCollaborationRuntimeStore((state) => state.presenceTarget);
  const activeDocumentStream = useCollaborationRuntimeStore((state) => state.activeDocumentStream);
  const mediaState = useCollaborationRuntimeStore((state) => state.mediaState);
  const collaborationActions = useCollaborationRuntimeStore((state) => state.actions);
  const openBuffer = useBufferStore.use.actions().openBuffer;
  const setActiveBuffer = useBufferStore.use.actions().setActiveBuffer;
  const [activeTab, setActiveTab] = useState<CollaborationSidebarTab>("channels");
  const [openConversation, setOpenConversation] = useState<CollaborationConversation | null>(null);
  const [channelSearchQuery, setChannelSearchQuery] = useState("");
  const [peopleSearchQuery, setPeopleSearchQuery] = useState("");
  const [notesSearchQuery, setNotesSearchQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState<CollaborationChannelFilter>("all");
  const [peopleFilter, setPeopleFilter] = useState<CollaborationPeopleFilter>("all");
  const [notesFilter, setNotesFilter] = useState<CollaborationNotesFilter>("notes");
  const [isChannelsSectionCollapsed, setIsChannelsSectionCollapsed] = useState(false);
  const [isPrivateChatsSectionCollapsed, setIsPrivateChatsSectionCollapsed] = useState(false);
  const [isChannelFilterOpen, setIsChannelFilterOpen] = useState(false);
  const [isPeopleFilterOpen, setIsPeopleFilterOpen] = useState(false);
  const [isNotesFilterOpen, setIsNotesFilterOpen] = useState(false);
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
    let channels = model?.channels ?? [];

    if (channelFilter === "active") {
      channels = selectedChannel
        ? channels.filter((channel) => channel.id === selectedChannel.id)
        : [];
    } else if (channelFilter === "with-guests") {
      channels = channels.filter((channel) => channel.guestCount > 0);
    } else if (channelFilter === "empty") {
      channels = channels.filter(
        (channel) => channel.memberCount === 0 && channel.guestCount === 0,
      );
    }

    if (!channelSearch) return channels;

    return channels.filter((channel) =>
      matchesSearchQuery(channelSearch, [
        channel.slug,
        channel.description,
        channel.memberCount,
        channel.guestCount,
        channel.id,
      ]),
    );
  }, [channelFilter, channelSearch, model?.channels, selectedChannel]);
  const filteredParticipants = useMemo(() => {
    let participants = model?.participants ?? [];

    if (peopleFilter === "online") {
      participants = participants.filter((participant) => participant.online);
    } else if (peopleFilter === "offline") {
      participants = participants.filter((participant) => !participant.online);
    } else if (peopleFilter === "sharing") {
      participants = participants.filter(
        (participant) => participant.microphone || participant.screen,
      );
    } else if (peopleFilter === "has-file") {
      participants = participants.filter((participant) => Boolean(participant.activeFilePath));
    }

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
  }, [model?.participants, peopleFilter, peopleSearch]);
  const filteredPrivateChatParticipants = useMemo(() => {
    if (channelFilter !== "all") return [];

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
  }, [channelFilter, channelSearch, model?.participants]);
  const filteredNoteItems = useMemo(() => {
    if (notesFilter === "secrets") return [];

    const items = model?.notesItems ?? [];
    if (!notesSearch) return items;

    return items.filter((item) =>
      matchesSearchQuery(notesSearch, [
        item.path,
        item.type,
        item.type === "file" ? item.content : null,
      ]),
    );
  }, [model?.notesItems, notesFilter, notesSearch]);
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
      <SidebarPanel>
        <SidebarHeader>
          <div className="font-sans flex items-center gap-2 text-text ui-text-sm">
            <UsersThree weight="duotone" />
            Collaboration
          </div>
        </SidebarHeader>
        <SidebarEmptyActionState
          className="h-full"
          message="Teams workspace is not available for this account."
        />
      </SidebarPanel>
    );
  }

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

  const updateChannelIcon = (channelId: number, icon: string | null) => {
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
  };

  const selectTab = (tab: CollaborationSidebarTab) => {
    setActiveTab(tab);
    if (tab === "channels") {
      setOpenConversation(null);
    }
  };

  const channel = channelsContextMenu.data;
  const channelMenuItems: ContextMenuItem[] = [
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

  const participant = participantContextMenu.data;
  const participantMenuItems: ContextMenuItem[] = participant
    ? [
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
      ]
    : [];

  const item = notesContextMenu.data;
  const noteMenuItems: ContextMenuItem[] = [
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

  const channelFilterMenuItems = createCollaborationFilterMenuItems({
    activeId: channelFilter,
    onClose: () => setIsChannelFilterOpen(false),
    onSelect: setChannelFilter,
    options: CHANNEL_FILTER_OPTIONS,
  });
  const peopleFilterMenuItems = createCollaborationFilterMenuItems({
    activeId: peopleFilter,
    onClose: () => setIsPeopleFilterOpen(false),
    onSelect: setPeopleFilter,
    options: PEOPLE_FILTER_OPTIONS,
  });
  const notesFilterMenuItems = createCollaborationFilterMenuItems({
    activeId: notesFilter,
    onClose: () => setIsNotesFilterOpen(false),
    onSelect: setNotesFilter,
    options: NOTE_FILTER_OPTIONS,
  });

  const channelsContent = (
    <div className="h-full min-h-0 overflow-hidden">
      {openConversation === null ? (
        <div
          className="h-full select-none overflow-y-auto px-1 py-1"
          onContextMenu={(event) => channelsContextMenu.open(event)}
        >
          <SidebarSearchFilterRow
            value={channelSearchQuery}
            onChange={setChannelSearchQuery}
            searchIcon={Search}
            filterOpen={isChannelFilterOpen}
            onFilterOpenChange={setIsChannelFilterOpen}
            filterItems={channelFilterMenuItems}
            filterActive={channelFilter !== "all"}
            filterTooltip="Filter Channels"
            filterAriaLabel="Filter channels"
            filterMenuClassName="min-w-32"
          />
          <div className="space-y-px">
            <SidebarSectionHeader
              expanded={!isChannelsSectionCollapsed}
              count={filteredChannels.length}
              onToggle={() => setIsChannelsSectionCollapsed((collapsed) => !collapsed)}
            >
              Channels
            </SidebarSectionHeader>
            {!isChannelsSectionCollapsed ? (
              <>
                {isCreatingChannel ? (
                  <form
                    className="mb-1 flex h-8 items-center gap-1 rounded-sm bg-hover/70 px-1.5"
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
                      className="h-6 min-w-0 bg-transparent ui-text-sm"
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
                      className="ui-text-sm h-6 px-2"
                      disabled={!newChannelName.trim() || isSending}
                    >
                      Create
                    </Button>
                  </form>
                ) : null}
                {filteredChannels.map((channel) => (
                  <SidebarListItem
                    key={channel.id}
                    type="button"
                    className={cn("min-h-8 py-1 ui-text-sm")}
                    active={selectedChannel?.id === channel.id}
                    onClick={() => openChannelChat(channel.id)}
                    onContextMenu={(event) => channelsContextMenu.open(event, channel)}
                    leading={
                      <span className="ui-text-sm flex size-4 items-center justify-center">
                        {renderChannelIcon(channelIcons[String(channel.id)])}
                      </span>
                    }
                    trailing={
                      <Tooltip content={`${channel.memberCount} members`} side="top">
                        <span className="ui-text-sm">{channel.memberCount}</span>
                      </Tooltip>
                    }
                  >
                    <span className="block truncate font-medium">#{channel.slug}</span>
                  </SidebarListItem>
                ))}
              </>
            ) : null}
            {channelFilter === "all" ? (
              <SidebarSectionHeader
                className="mt-2"
                expanded={!isPrivateChatsSectionCollapsed}
                count={filteredPrivateChatParticipants.length}
                onToggle={() => setIsPrivateChatsSectionCollapsed((collapsed) => !collapsed)}
              >
                Private chats
              </SidebarSectionHeader>
            ) : null}
            {channelFilter === "all" &&
            !isPrivateChatsSectionCollapsed &&
            filteredPrivateChatParticipants.length > 0 ? (
              <div>
                <div className="space-y-px">
                  {filteredPrivateChatParticipants.map((participant) => (
                    <SidebarListItem
                      key={participant.id}
                      type="button"
                      className="min-h-8 ui-text-sm"
                      onClick={() => openPrivateChat(participant.id)}
                      onContextMenu={(event) => participantContextMenu.open(event, participant)}
                      leading={<CollaborationAvatar name={participant.name} />}
                      trailing={<PresenceStatusDot online={participant.online} />}
                    >
                      <span className="block truncate font-medium">{participant.name}</span>
                    </SidebarListItem>
                  ))}
                </div>
              </div>
            ) : null}
            {(channelSearch || channelFilter !== "all") &&
            filteredChannels.length === 0 &&
            filteredPrivateChatParticipants.length === 0 ? (
              <SidebarEmptyActionState className="min-h-24" message="No matching channels." />
            ) : null}
          </div>
        </div>
      ) : null}
      {openConversation?.type === "channel" ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex min-w-0 items-center gap-1 px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              className="rounded-md"
              tooltip="Back to Channels"
              tooltipSide="bottom"
              onClick={() => setOpenConversation(null)}
              size="icon-sm"
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
                  className="h-7 max-w-[128px] rounded-md px-2 ui-text-sm"
                  onClick={() => openChannelChat(channel.id)}
                  onContextMenu={(event) => channelsContextMenu.open(event, channel)}
                >
                  <span className="shrink-0 ui-text-sm">
                    {renderChannelIcon(channelIcons[String(channel.id)])}
                  </span>
                  <span className="truncate">#{channel.slug}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="space-y-1.5">
              {model.chatGroups.length > 0 ? (
                model.chatGroups.slice(-10).map((group) => (
                  <div key={group.id} className="flex gap-2">
                    <CollaborationAvatar name={group.author} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="px-1 text-text-lighter ui-text-sm">{group.author}</div>
                      <div className="space-y-px">
                        {group.entries.map((entry, index) => (
                          <div
                            key={entry.id}
                            className={cn(
                              "border border-border/45 bg-secondary-bg/45 px-2.5 py-1.5 text-text ui-text-sm leading-5",
                              index === 0 && "rounded-t-lg",
                              index === group.entries.length - 1 && "rounded-b-lg",
                              group.entries.length === 1 && "rounded-lg",
                            )}
                          >
                            {entry.kind === "document" ? (
                              <span className="mb-0.5 flex items-center gap-1.5 text-text-lighter ui-text-sm">
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
                <SidebarEmptyActionState className="min-h-24" message="No chats yet." />
              )}
            </div>
          </div>

          <CollaborationMessageComposer
            value={draft}
            placeholder={
              model.canEditNotes ? `Message #${openChannel?.slug ?? "channel"}` : "Read only"
            }
            error={sendError}
            disabled={!selectedChannel || !model.canEditNotes}
            isSending={isSending}
            canShareDocuments
            onChange={setDraft}
            onShareDocuments={() => void shareDocuments()}
            onSubmit={() => void sendMessage()}
          />
        </div>
      ) : null}
      {openConversation?.type === "private" ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              className="rounded-md"
              tooltip="Back to Channels"
              tooltipSide="bottom"
              onClick={() => setOpenConversation(null)}
              size="icon-sm"
            >
              <CaretLeft />
            </Button>
            {openPrivateParticipant ? (
              <>
                <CollaborationAvatar
                  name={openPrivateParticipant.name}
                  online={openPrivateParticipant.online}
                />
                <div className="min-w-0 flex-1 truncate text-text ui-text-sm">
                  {openPrivateParticipant.name}
                </div>
                <PresenceStatusDot online={openPrivateParticipant.online} />
              </>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="space-y-1.5">
              {privateChatEntries.length > 0 ? (
                privateChatEntries.map((entry) => {
                  const author = model.activeMembers.find(
                    (member) => member.id === entry.authorMemberId,
                  );
                  const authorName = author?.name ?? "Member";
                  return (
                    <div key={entry.id} className="flex gap-2">
                      <CollaborationAvatar name={authorName} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="px-1 text-text-lighter ui-text-sm">{authorName}</div>
                        <div className="rounded-lg border border-border/45 bg-secondary-bg/45 px-2.5 py-1.5 text-text ui-text-sm leading-5">
                          {entry.body}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <SidebarEmptyActionState className="min-h-24" message="No private messages yet." />
              )}
            </div>
          </div>

          <CollaborationMessageComposer
            value={draft}
            placeholder={
              model.canEditNotes
                ? `Message ${openPrivateParticipant?.name ?? "teammate"}`
                : "Read only"
            }
            error={sendError}
            disabled={!openPrivateParticipant || !model.canEditNotes}
            isSending={isSending}
            onChange={setDraft}
            onSubmit={() => void sendPrivateMessage()}
          />
        </div>
      ) : null}
    </div>
  );

  const peopleContent = (
    <div className="h-full overflow-y-auto px-1 py-1">
      <SidebarSearchFilterRow
        value={peopleSearchQuery}
        onChange={setPeopleSearchQuery}
        searchIcon={Search}
        filterOpen={isPeopleFilterOpen}
        onFilterOpenChange={setIsPeopleFilterOpen}
        filterItems={peopleFilterMenuItems}
        filterActive={peopleFilter !== "all"}
        filterTooltip="Filter People"
        filterAriaLabel="Filter people"
        filterMenuClassName="min-w-32"
      />
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
            <SidebarListItem
              key={participant.id}
              className={cn("min-h-8 ui-text-sm", participant.online && "text-text")}
              active={presenceTarget.followingUserId === participant.followableUserId}
              onContextMenu={(event) => participantContextMenu.open(event, participant)}
              onClick={() =>
                participant.followableUserId &&
                participant.followableUserId !== user?.id &&
                collaborationActions.setFollowingUser(participant.followableUserId)
              }
              disabled={!participant.followableUserId || participant.followableUserId === user?.id}
              leading={<CollaborationAvatar name={participant.name} />}
              trailing={
                <span className="flex items-center gap-1">
                  <PresenceStatusDot online={participant.online} />
                  {participant.microphone ? <Mic className="size-3 shrink-0" /> : null}
                  {participant.screen ? <Monitor className="size-3 shrink-0" /> : null}
                  {participant.activeFilePath ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-6 px-2 ui-text-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        void openParticipantFile(participant.activeFilePath!);
                      }}
                    >
                      Open
                    </Button>
                  ) : null}
                </span>
              }
            >
              <span className="block truncate">{participant.name}</span>
            </SidebarListItem>
          ))
        ) : (
          <SidebarEmptyActionState
            className="min-h-24"
            message={
              peopleSearch || peopleFilter !== "all" ? "No matching members." : "No members yet."
            }
          />
        )}
      </div>
    </div>
  );

  const notesContent = (
    <div
      className="h-full overflow-y-auto px-1 py-1"
      onContextMenu={(event) => notesContextMenu.open(event)}
    >
      <SidebarSearchFilterRow
        value={notesSearchQuery}
        onChange={setNotesSearchQuery}
        searchIcon={Search}
        filterOpen={isNotesFilterOpen}
        onFilterOpenChange={setIsNotesFilterOpen}
        filterItems={notesFilterMenuItems}
        filterActive={notesFilter !== "notes"}
        filterTooltip="Filter Notes"
        filterAriaLabel="Filter notes"
        filterMenuClassName="min-w-32"
      />
      <div className="space-y-px">
        {filteredNoteItems.map((item) => {
          return (
            <SidebarListItem
              key={`${item.type}:${item.path}`}
              type="button"
              className={cn("min-h-7 ui-text-sm")}
              active={
                (item.type === "file" &&
                  selectedNoteItemType === "file" &&
                  selectedNoteFile?.path === item.path) ||
                (item.type === "folder" &&
                  selectedNoteItemType === "folder" &&
                  selectedNoteFolder?.path === item.path)
              }
              onClick={() => {
                if (item.type === "folder") {
                  setSelectedNoteItemType("folder");
                  setSelectedNoteFolderPath(item.path);
                  return;
                }

                setSelectedNoteItemType("file");
                setSelectedNotePath(item.path);
                setSelectedNoteFolderPath(item.path.split("/").slice(0, -1).join("/") || null);
                openNoteFileInEditor(item);
              }}
              onContextMenu={(event) => notesContextMenu.open(event, item)}
              leading={
                item.type === "folder" ? (
                  <Folder className="size-3.5" weight="duotone" />
                ) : (
                  <FileText className="size-3.5" weight="duotone" />
                )
              }
            >
              <span
                className="block truncate"
                style={{ paddingLeft: `${Math.max(item.path.split("/").length - 1, 0) * 10}px` }}
              >
                {item.path.split("/").slice(-1)[0]}
              </span>
            </SidebarListItem>
          );
        })}
        {filteredNoteItems.length === 0 ? (
          <SidebarEmptyActionState
            className="min-h-24"
            message={notesFilter === "secrets" ? "No secrets yet." : "No matching notes."}
            description={
              notesFilter === "secrets"
                ? "Shared environment files will appear here when they are added."
                : undefined
            }
          />
        ) : null}
      </div>
    </div>
  );

  return (
    <SidebarPanel className="gap-1 p-1">
      <SidebarHeader className="relative z-[10020] bg-transparent p-0 backdrop-blur-none">
        <SidebarSectionSwitcher
          items={COLLABORATION_TABS}
          value={activeTab}
          onChange={(tab) => selectTab(tab as CollaborationSidebarTab)}
        />
      </SidebarHeader>

      <SidebarSectionPager
        className="flex-1"
        items={[
          { id: "channels", content: channelsContent },
          { id: "people", content: peopleContent },
          { id: "notes", content: notesContent },
        ]}
        value={activeTab}
        onChange={(tab) => selectTab(tab as CollaborationSidebarTab)}
      />

      <CollaborationMediaFooter
        workspaceName={model.workspaceName}
        micState={micState}
        screenState={screenState}
        onlineCount={model.onlineCount}
        streamStatus={activeDocumentStream.status}
        isFollowing={Boolean(presenceTarget.followingUserId)}
        onToggleMic={() => void toggleMic()}
        onToggleScreenShare={() => void toggleScreenShare()}
        onStopFollowing={() => collaborationActions.setFollowingUser(null)}
      />

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
    </SidebarPanel>
  );
}
