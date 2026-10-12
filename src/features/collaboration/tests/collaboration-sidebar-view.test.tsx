// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { SubscriptionInfo } from "@/features/auth/services/auth-api";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { CollaborationSidebarView } from "../components/collaboration-sidebar";
import { useCollaborationRuntimeStore } from "../stores/collaboration-runtime.store";

type Snapshot = NonNullable<SubscriptionInfo["collaboration"]>;

const remote = vi.hoisted(() => ({
  updateNote: vi.fn(),
  createChannel: vi.fn(),
  sendPrivate: vi.fn(),
  readFile: vi.fn(),
  pickFiles: vi.fn(),
  toasts: [] as string[],
  sent: [] as Array<{ to: string | null; kind: string }>,
  transport: null as null | {
    onSignal: (signal: Record<string, unknown>) => Promise<void> | void;
    onDeviceJoined?: (deviceId: string) => void;
  },
}));

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

vi.mock("../services/collaboration-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/collaboration-api")>()),
  getCollaborationClientId: () => "local-device",
  updateCollaborationChannelNote: remote.updateNote,
  createCollaborationChannel: remote.createChannel,
  appendCollaborationPrivateChatMessage: remote.sendPrivate,
}));
vi.mock("../services/collaboration-media-signaling", () => ({
  createMediaSignalTransport: (options: NonNullable<typeof remote.transport>) => {
    remote.transport = options;
    return {
      send: async (to: string | null, kind: string) => {
        remote.sent.push({ to, kind });
      },
      setActive: () => {},
      close: () => {},
    };
  },
}));
vi.mock("../services/collaboration-ice-servers", () => ({
  getCollaborationIceServers: async () => [],
}));
vi.mock("@/features/file-system/api/file-operations", () => ({
  readFileContent: remote.readFile,
}));
vi.mock("@/utils/file-dialogs", () => ({ pickFiles: remote.pickFiles }));
vi.mock("sonner", () => {
  const toast = Object.assign((message: string) => remote.toasts.push(message), {
    error: (message: string) => remote.toasts.push(message),
    success: (message: string) => remote.toasts.push(message),
    info: (message: string) => remote.toasts.push(message),
    dismiss: () => {},
  });
  return { toast };
});

enableMapSet();

const notes = (threads: string, workspace = "") =>
  [
    "<!-- athas:threads -->",
    threads,
    "<!-- /athas:threads -->",
    "",
    "<!-- athas:notes -->",
    workspace,
    "<!-- /athas:notes -->",
  ].join("\n");

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    enabled: true,
    workspace: {
      id: 1,
      name: "Athas Team",
      slug: "athas-team",
      role: "owner",
      visibility: "workspace",
      realtimeProtocolVersion: 1,
    },
    members: [
      {
        id: 1,
        userId: 1,
        name: "Mehmet",
        email: "mehmet@example.com",
        role: "owner",
        status: "active",
        lastSeenAt: null,
      },
      {
        id: 2,
        userId: 2,
        name: "Ada",
        email: "ada@example.com",
        role: "member",
        status: "active",
        lastSeenAt: null,
      },
    ],
    invitations: [],
    projects: [],
    channels: [
      {
        id: 10,
        name: "General",
        slug: "general",
        description: null,
        visibility: "workspace",
        parentChannelId: null,
        memberCount: 2,
        guestCount: 0,
        noteVersion: 1,
        notePreview: "",
        updatedAt: null,
      },
      {
        id: 11,
        name: "Design",
        slug: "design",
        description: null,
        visibility: "workspace",
        parentChannelId: null,
        memberCount: 1,
        guestCount: 0,
        noteVersion: 1,
        notePreview: "",
        updatedAt: null,
      },
    ],
    channelNotes: [
      {
        channelId: 10,
        contentMarkdown: notes(
          "- **Mehmet**: Ship the sidebar",
          "## Plan\n\nShip the sidebar tabs.",
        ),
        version: 1,
        updatedAt: null,
      },
    ],
    privateChats: [],
    channelGuests: [],
    settings: null,
    activity: [],
    presence: [
      {
        id: 1,
        userId: 2,
        channelId: 10,
        channelName: "General",
        channelSlug: "general",
        followingUserId: null,
        followingUserName: null,
        deviceId: "ada-laptop",
        status: "online",
        activeFilePath: "/repo/src/app.ts",
        cursorLabel: "mic",
        heartbeatAt: null,
      },
    ],
    documents: [],
    documentUpdates: [],
    mediaSignals: [],
    capabilities: {
      canInvite: true,
      canManageMembers: true,
      canShareProjects: true,
      canCreateChannels: true,
      canEditChannelNotes: true,
      activityFeed: true,
      presence: true,
      realtimeDocuments: true,
    },
    ...overrides,
  } as Snapshot;
}

function withChannelNote(base: Snapshot, channelId: number, contentMarkdown: string): Snapshot {
  return {
    ...base,
    channelNotes: [
      ...base.channelNotes.filter((note) => note.channelId !== channelId),
      { channelId, contentMarkdown, version: 2, updatedAt: null },
    ],
  };
}

let root: Root;
let container: HTMLDivElement;

async function render(collaboration: Snapshot = snapshot()) {
  useAuthStore.setState({
    user: { id: 1, name: "Mehmet", email: "mehmet@example.com" },
    subscription: { collaboration },
  } as never);
  await act(async () => root.render(<CollaborationSidebarView />));
}

const current = () => useAuthStore.getState().subscription!.collaboration as Snapshot;
const body = () => within(document.body);

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
}

async function contextMenu(element: Element) {
  await act(async () => {
    fireEvent.contextMenu(element, { clientX: 10, clientY: 10 });
  });
}

const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === label,
  )!;

async function openTab(name: string) {
  await click(within(container).getByRole("tab", { name }));
}

async function typeMessage(placeholder: string, text: string) {
  const textarea = within(container).getByPlaceholderText(placeholder);
  await act(async () => {
    fireEvent.change(textarea, { target: { value: text } });
  });
  return textarea;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  remote.updateNote.mockReset();
  remote.createChannel.mockReset();
  remote.sendPrivate.mockReset();
  remote.readFile.mockReset();
  remote.pickFiles.mockReset();
  remote.toasts.length = 0;
  remote.sent.length = 0;
  remote.transport = null;
  window.localStorage.clear();
  useCollaborationRuntimeStore.setState((state) => ({
    presenceTarget: { ...state.presenceTarget, channelId: null, followingUserId: null },
    mediaState: { microphone: false, screen: false },
  }));
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("collaboration sidebar", () => {
  it("explains when the account has no team workspace", async () => {
    await render({ ...snapshot(), enabled: false });
    expect(
      within(container).getByText("Teams workspace is not available for this account."),
    ).toBeTruthy();
  });

  it("opens a channel, shows its chat and posts a message", async () => {
    await render();
    expect(within(container).getByText("general")).toBeTruthy();
    expect(within(container).getByText("design")).toBeTruthy();

    await click(within(container).getByText("general").closest("button")!);
    expect(useCollaborationRuntimeStore.getState().presenceTarget.channelId).toBe(10);
    expect(within(container).getByText("Ship the sidebar")).toBeTruthy();

    remote.updateNote.mockImplementation(async ({ channelId, contentMarkdown }) =>
      withChannelNote(current(), channelId, contentMarkdown),
    );
    const textarea = await typeMessage("Message #general", "Reviewing now");
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
      await Promise.resolve();
    });
    expect(remote.updateNote).toHaveBeenCalledWith({
      channelId: 10,
      contentMarkdown: expect.stringContaining("- **Mehmet**: Reviewing now"),
    });
    expect(within(container).getByText("Reviewing now")).toBeTruthy();
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the draft and shows the error when a message fails", async () => {
    await render();
    await click(within(container).getByText("general").closest("button")!);
    remote.updateNote.mockRejectedValue(new Error("Server unavailable"));
    await typeMessage("Message #general", "Hello");
    await click(within(container).getByRole("button", { name: "Send" }));
    expect(within(container).getByText("Server unavailable")).toBeTruthy();
    expect(
      (within(container).getByPlaceholderText("Message #general") as HTMLTextAreaElement).value,
    ).toBe("Hello");
  });

  it("switches channels from the conversation header and goes back to the list", async () => {
    await render();
    await click(within(container).getByText("general").closest("button")!);
    const tabs = within(container).getAllByText("design");
    await click(tabs[0].closest("button")!);
    expect(useCollaborationRuntimeStore.getState().presenceTarget.channelId).toBe(11);
    expect(within(container).getByText("No chats yet.")).toBeTruthy();

    await click(within(container).getByRole("button", { name: "Back to Channels" }));
    expect(within(container).getByText("Private chats")).toBeTruthy();
  });

  it("shares documents into the channel", async () => {
    await render();
    await click(within(container).getByText("general").closest("button")!);
    remote.pickFiles.mockResolvedValue(["/repo/docs/spec.pdf", "/repo/docs/brief.md"]);
    remote.updateNote.mockImplementation(async ({ channelId, contentMarkdown }) =>
      withChannelNote(current(), channelId, contentMarkdown),
    );
    await click(within(container).getByRole("button", { name: "Share Documents" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(remote.toasts).toContain("2 documents shared.");
    expect(container.textContent).toContain("spec.pdf");
  });

  it("creates a channel from the list context menu and opens it", async () => {
    await render();
    await contextMenu(within(container).getByText("general").closest("button")!);
    await click(menuItem("New Channel"));

    const name = within(container).getByPlaceholderText("channel-name");
    await act(async () => {
      fireEvent.keyDown(name, { key: "Escape" });
    });
    expect(within(container).queryByPlaceholderText("channel-name")).toBeNull();

    await contextMenu(within(container).getByText("design").closest("button")!);
    await click(menuItem("New Channel"));
    remote.createChannel.mockImplementation(async () => ({
      ...current(),
      channels: [
        ...current().channels,
        { ...current().channels[1], id: 12, name: "Releases", slug: "releases" },
      ],
    }));
    await act(async () => {
      fireEvent.change(within(container).getByPlaceholderText("channel-name"), {
        target: { value: "releases" },
      });
    });
    await click(within(container).getByRole("button", { name: "Create" }));
    expect(remote.createChannel).toHaveBeenCalledWith({ name: "releases" });
    expect(useCollaborationRuntimeStore.getState().presenceTarget.channelId).toBe(12);
    expect(within(container).getByPlaceholderText("Message #releases")).toBeTruthy();
  });

  it("reports a channel that could not be created", async () => {
    await render();
    await contextMenu(within(container).getByText("general").closest("button")!);
    await click(menuItem("New Channel"));
    remote.createChannel.mockRejectedValue(new Error("Name taken"));
    await act(async () => {
      fireEvent.change(within(container).getByPlaceholderText("channel-name"), {
        target: { value: "general" },
      });
    });
    await act(async () => {
      fireEvent.submit(within(container).getByPlaceholderText("channel-name").closest("form")!);
      await Promise.resolve();
    });
    expect(remote.toasts).toContain("Name taken");
  });

  it("gives a channel a custom icon from its context menu", async () => {
    await render();
    await contextMenu(within(container).getByText("design").closest("button")!);
    await click(menuItem("Change Icon"));
    const choice = body()
      .getAllByRole("button")
      .find((button) => button.textContent === "🚀");
    await click(choice!);
    expect(
      JSON.parse(window.localStorage.getItem("athas.collaboration.channel-icons") ?? "{}"),
    ).toEqual({ "11": "🚀" });
    expect(within(container).getByText("design").closest("button")!.textContent).toContain("🚀");
  });

  it("opens a private chat with a teammate and sends a message", async () => {
    await render();
    await click(within(container).getByText("Ada").closest("button")!);
    expect(within(container).getByText("No private messages yet.")).toBeTruthy();

    remote.sendPrivate.mockImplementation(async ({ memberId, body }) => ({
      ...current(),
      privateChats: [
        { id: 1, conversationMemberId: memberId, authorMemberId: 1, body, createdAt: null },
      ],
    }));
    await typeMessage("Message Ada", "Can you review?");
    await click(within(container).getByRole("button", { name: "Send" }));
    expect(remote.sendPrivate).toHaveBeenCalledWith({ memberId: 2, body: "Can you review?" });
    expect(within(container).getByText("Can you review?")).toBeTruthy();
  });

  it("follows a teammate and opens the file they are working in", async () => {
    await render();
    await openTab("People");
    const people = () =>
      within(
        within(container)
          .getByRole("button", { name: "Filter people" })
          .closest<HTMLElement>('[role="tabpanel"]')!,
      );
    expect(people().getByRole("img", { name: "Microphone on" })).toBeTruthy();
    expect(people().getByText("app.ts")).toBeTruthy();

    await click(people().getByText("Ada").closest("button")!);
    expect(useCollaborationRuntimeStore.getState().presenceTarget.followingUserId).toBe(2);

    remote.readFile.mockResolvedValue("export const app = true;");
    await contextMenu(people().getByText("Ada").closest("button")!);
    await click(menuItem("Open Active File"));
    await act(async () => {
      await Promise.resolve();
    });
    const buffer = useBufferStore
      .getState()
      .buffers.find((item) => item.path === "/repo/src/app.ts");
    expect(buffer).toBeTruthy();

    await contextMenu(people().getByText("Ada").closest("button")!);
    await click(menuItem("Message"));
    await openTab("Channels");
    expect(within(container).getByText("Private chats")).toBeTruthy();
  });

  it("filters people to members who are sharing", async () => {
    await render();
    await openTab("People");
    await click(within(container).getByRole("button", { name: "Filter people" }));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent === "Offline",
      )!,
    );
    expect(within(container).getByText("Mehmet")).toBeTruthy();
    expect(within(container).queryByText("Ada")).toBeNull();
  });

  it("opens shared notes in the editor and manages note files", async () => {
    await render();
    await openTab("Notes");
    await click(within(container).getByText("notes.md").closest("button")!);
    const opened = useBufferStore.getState().buffers.find((item) => item.name === "notes.md");
    expect(opened && "content" in opened ? opened.content : "").toContain("Ship the sidebar tabs.");

    remote.updateNote.mockImplementation(async ({ channelId, contentMarkdown }) =>
      withChannelNote(current(), channelId, contentMarkdown),
    );
    vi.spyOn(window, "prompt").mockReturnValueOnce("ideas.md");
    await contextMenu(within(container).getByText("notes.md").closest("button")!);
    await click(menuItem("New Markdown File"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(container).getByText("ideas.md")).toBeTruthy();
    expect(useBufferStore.getState().buffers.some((item) => item.name === "ideas.md")).toBe(true);

    vi.spyOn(window, "prompt").mockReturnValueOnce("archive");
    await contextMenu(within(container).getByText("ideas.md").closest("button")!);
    await click(menuItem("New Folder"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(container).getByText("archive")).toBeTruthy();

    await contextMenu(within(container).getByText("ideas.md").closest("button")!);
    await click(menuItem("Rename"));
    const rename = within(container).getByRole("textbox", { name: "Rename ideas.md" });
    await act(async () => {
      fireEvent.change(rename, { target: { value: "roadmap.md" } });
    });
    await act(async () => {
      fireEvent.keyDown(rename, { key: "Enter" });
      await Promise.resolve();
    });
    expect(within(container).getByText("roadmap.md")).toBeTruthy();

    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    await contextMenu(within(container).getByText("roadmap.md").closest("button")!);
    await click(menuItem("Delete"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(within(container).queryByText("roadmap.md")).toBeNull();
  });

  it("shows an empty secrets view", async () => {
    await render();
    await openTab("Notes");
    await click(within(container).getByRole("button", { name: "Filter notes" }));
    await click(
      [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
        (item) => item.textContent === "Secrets",
      )!,
    );
    expect(within(container).getByText("No secrets yet.")).toBeTruthy();
  });

  it("turns the microphone on and off and reports a blocked screen share", async () => {
    const peers: Array<{ closed: boolean; tracks: number }> = [];
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        state = { closed: false, tracks: 0 };
        connectionState = "new";
        onicecandidate: unknown = null;
        ontrack: unknown = null;
        constructor() {
          peers.push(this.state);
        }
        addTrack() {
          this.state.tracks += 1;
        }
        async createOffer() {
          return { type: "offer", sdp: "v=0" };
        }
        async setLocalDescription() {}
        close() {
          this.state.closed = true;
        }
      },
    );
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ readyState: "live", stop }],
          getAudioTracks: () => [{ kind: "audio", readyState: "live", stop }],
        })),
      },
    });
    await render();
    await click(within(container).getByRole("button", { name: "Start Mic" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(useCollaborationRuntimeStore.getState().mediaState.microphone).toBe(true);
    expect(peers).toEqual([{ closed: false, tracks: 1 }]);

    await click(within(container).getByRole("button", { name: "Stop Mic" }));
    expect(stop).toHaveBeenCalled();
    expect(useCollaborationRuntimeStore.getState().mediaState.microphone).toBe(false);
    expect(peers[0].closed).toBe(true);

    await click(within(container).getByRole("button", { name: "Share Screen" }));
    expect(remote.toasts).toContain("Screen sharing is unavailable in this webview.");
    Reflect.deleteProperty(navigator, "mediaDevices");
  });

  it("answers a teammate's screen share and shows it until they leave", async () => {
    const peers: Array<{ remote?: unknown; candidates: unknown[]; closed: boolean }> = [];
    let ontrack: ((event: { streams: unknown[] }) => void) | null = null;
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        state = { candidates: [] as unknown[], closed: false } as (typeof peers)[number];
        constructor() {
          peers.push(this.state);
        }
        set ontrack(handler: typeof ontrack) {
          ontrack = handler;
        }
        set onicecandidate(handler: unknown) {
          void handler;
        }
        addTrack() {}
        async setRemoteDescription(description: unknown) {
          this.state.remote = description;
        }
        async createAnswer() {
          return { type: "answer", sdp: "v=0" };
        }
        async setLocalDescription() {}
        async addIceCandidate(candidate: unknown) {
          this.state.candidates.push(candidate);
        }
        close() {
          this.state.closed = true;
        }
      },
    );
    vi.stubGlobal(
      "RTCSessionDescription",
      class {
        init: unknown;
        constructor(init: unknown) {
          this.init = init;
        }
      },
    );
    vi.stubGlobal(
      "RTCIceCandidate",
      class {
        init: unknown;
        constructor(init: unknown) {
          this.init = init;
        }
      },
    );
    await render(
      snapshot({
        presence: [{ ...snapshot().presence[0], cursorLabel: "screen" }],
      }),
    );
    await openTab("People");

    await act(async () => {
      await remote.transport!.onSignal({
        kind: "offer",
        senderDeviceId: "ada-laptop",
        payload: { type: "offer", sdp: "v=0" },
      });
    });
    expect(remote.sent).toContainEqual({ to: "ada-laptop", kind: "answer" });

    await act(async () => {
      await remote.transport!.onSignal({
        kind: "ice",
        senderDeviceId: "ada-laptop",
        payload: { candidate: "candidate:1" },
      });
      await remote.transport!.onSignal({
        kind: "answer",
        senderDeviceId: "ada-laptop",
        payload: { type: "answer", sdp: "v=1" },
      });
    });
    expect(peers).toHaveLength(1);
    expect(peers[0].candidates).toHaveLength(1);

    const stream = { getVideoTracks: () => [{}], getTracks: () => [] };
    await act(async () => ontrack!({ streams: [stream] }));
    expect(within(container).getByText("Screen")).toBeTruthy();

    await act(async () => {
      await remote.transport!.onSignal({
        kind: "leave",
        senderDeviceId: "ada-laptop",
        payload: {},
      });
    });
    expect(peers[0].closed).toBe(true);
    expect(within(container).queryByText("Screen")).toBeNull();
  });

  it("reports a microphone that cannot be opened", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => {
          throw new Error("Permission denied");
        }),
      },
    });
    await render();
    await click(within(container).getByRole("button", { name: "Start Mic" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(remote.toasts).toContain("Microphone access failed: Permission denied");
    Reflect.deleteProperty(navigator, "mediaDevices");
  });
});
