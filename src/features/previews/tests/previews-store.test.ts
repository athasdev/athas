import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const api = vi.hoisted(() => ({
  createLocalPreview: vi.fn(),
  refreshPreviewTicket: vi.fn(),
  stopPreview: vi.fn(),
}));
vi.mock("../services/previews-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/previews-api")>()),
  ...api,
}));
vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: vi.fn() }));

import { PreviewEndedError } from "../services/preview-tunnel";
import { PreviewsError } from "../services/previews-api";
import { previewsStoreDependencies, usePreviewsStore } from "../stores/previews.store";
import { describePreview, parsePortInput } from "../services/preview-display";

const preview = {
  id: "abc",
  kind: "local" as const,
  url: "https://abc.athas-preview.dev",
  port: 5173,
  runId: null,
  active: true,
  createdAt: "2026-10-09T12:00:00.000Z",
  expiresAt: "2026-10-09T20:00:00.000Z",
  revokedAt: null,
  bytes: 0,
  requests: 0,
};

type TunnelOptions = Parameters<typeof previewsStoreDependencies.connectPreviewTunnel>[0];
let tunnelOptions: TunnelOptions;
const close = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  usePreviewsStore.setState({ shared: {}, isDialogOpen: false });
  api.createLocalPreview.mockResolvedValue({ preview, connect: { url: "wss://x", expiresAt: "" } });
  api.stopPreview.mockResolvedValue({ ...preview, active: false });
  previewsStoreDependencies.connectPreviewTunnel = vi.fn((options: TunnelOptions) => {
    tunnelOptions = options;
    return { close, status: () => "connecting" as const };
  });
});

describe("previews store", () => {
  it("shares a local server and tracks its tunnel and requests", async () => {
    const { shareLocalServer } = usePreviewsStore.getState().actions;
    await shareLocalServer(5173);
    expect(api.createLocalPreview).toHaveBeenCalledWith(5173);
    expect(tunnelOptions.port).toBe(5173);
    tunnelOptions.onStatus?.("open");
    tunnelOptions.onRequest?.({ method: "GET", path: "/", status: 200 });
    tunnelOptions.onRequest?.({ method: "GET", path: "/a", status: 404 });
    expect(usePreviewsStore.getState().shared.abc).toMatchObject({ status: "open", requests: 2 });

    tunnelOptions.onStatus?.("ended");
    expect(usePreviewsStore.getState().shared.abc).toBeUndefined();
  });

  it("refuses an invalid port before asking the account service", async () => {
    await expect(usePreviewsStore.getState().actions.shareLocalServer(0)).rejects.toThrow(
      "Enter a port",
    );
    expect(api.createLocalPreview).not.toHaveBeenCalled();
  });

  it("turns an ended preview into the tunnel's end signal", async () => {
    await usePreviewsStore.getState().actions.shareLocalServer(5173);
    api.refreshPreviewTicket.mockRejectedValueOnce(new PreviewsError("ended", 410));
    await expect(tunnelOptions.requestTicket()).rejects.toBeInstanceOf(PreviewEndedError);
    api.refreshPreviewTicket.mockRejectedValueOnce(new PreviewsError("offline", 503));
    await expect(tunnelOptions.requestTicket()).rejects.toBeInstanceOf(PreviewsError);
  });

  it("stops one preview or all of them", async () => {
    const { shareLocalServer, stopPreview, stopAll } = usePreviewsStore.getState().actions;
    await shareLocalServer(5173);
    await stopPreview("abc");
    expect(close).toHaveBeenCalledTimes(1);
    expect(api.stopPreview).toHaveBeenCalledWith("abc");
    expect(usePreviewsStore.getState().shared).toEqual({});

    api.createLocalPreview.mockResolvedValueOnce({
      preview: { ...preview, id: "def" },
      connect: { url: "wss://x", expiresAt: "" },
    });
    await shareLocalServer(5173);
    await shareLocalServer(3000);
    api.stopPreview.mockRejectedValueOnce(new Error("offline"));
    await stopAll();
    expect(close).toHaveBeenCalledTimes(3);
    expect(api.stopPreview).toHaveBeenCalledWith("def");
    expect(usePreviewsStore.getState().shared).toEqual({});
  });
});

describe("preview display", () => {
  it("parses the port field", () => {
    expect(parsePortInput(" 5173 ")).toBe(5173);
    expect(parsePortInput("0")).toBeNull();
    expect(parsePortInput("65536")).toBeNull();
    expect(parsePortInput("51.73")).toBeNull();
    expect(parsePortInput("")).toBeNull();
  });

  it("describes where a preview comes from", () => {
    expect(describePreview(preview, 1, "en-GB")).toMatch(
      /^localhost:5173 · 1 request · until \d\d:\d\d$/,
    );
    expect(describePreview({ ...preview, kind: "sandbox", port: 3000 }, 2, "en-GB")).toMatch(
      /^Cloud agent port 3000 · 2 requests/,
    );
  });
});
