// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const platform = vi.hoisted(() => ({ linux: false, mac: false }));
const toast = vi.hoisted(() => ({ warning: vi.fn(), error: vi.fn() }));

vi.mock("@/utils/platform", () => ({
  get IS_LINUX() {
    return platform.linux;
  },
  isMac: () => platform.mac,
}));
vi.mock("sonner", () => ({ toast }));

import { useVoiceInput } from "../hooks/use-voice-input";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

type Voice = ReturnType<typeof useVoiceInput>;
let root: Root;
let voice: Voice;
const insertText = vi.fn();
const focusInput = vi.fn();

function Harness({ enabled }: { enabled: boolean }) {
  voice = useVoiceInput({ enabled, insertText, focusInput });
  return null;
}

async function render(enabled = true) {
  await act(async () => root.render(createElement(Harness, { enabled })));
}

async function toggle() {
  await act(async () => {
    voice.toggle();
  });
}

function result(items: Array<[string, boolean]>, resultIndex = 0) {
  return {
    resultIndex,
    results: items.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
  };
}

const recognition = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  FakeRecognition.instances = [];
  platform.linux = false;
  platform.mac = false;
  Object.assign(window, { SpeechRecognition: FakeRecognition });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
    },
  });
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  Reflect.deleteProperty(window, "SpeechRecognition");
});

describe("useVoiceInput", () => {
  it("dictates final results into the input and shows interim text", async () => {
    await render();
    expect(voice.isSupported).toBe(true);

    await toggle();
    expect(voice.isListening).toBe(true);
    expect(recognition()).toMatchObject({ continuous: true, interimResults: true });
    expect(focusInput).toHaveBeenCalled();

    await act(async () => {
      recognition().onresult!(
        result([
          ["hello", true],
          [" ", true],
          ["wor", false],
        ]),
      );
    });
    expect(insertText).toHaveBeenCalledWith("hello ");
    expect(voice.interimTranscript).toBe("wor");

    await toggle();
    expect(recognition().stop).toHaveBeenCalled();
    expect(voice.isListening).toBe(false);
    expect(voice.interimTranscript).toBe("");
  });

  it("restarts after the browser ends a session while still listening", async () => {
    await render();
    await toggle();
    await act(async () => recognition().onend!());
    expect(recognition().start).toHaveBeenCalledTimes(2);
    expect(voice.isListening).toBe(true);

    recognition().start.mockImplementation(() => {
      throw new Error("already started");
    });
    await act(async () => recognition().onend!());
    expect(voice.isListening).toBe(false);
  });

  it("explains denied microphone access per platform", async () => {
    await render();
    await toggle();
    await act(async () => recognition().onerror!({ error: "not-allowed" }));
    expect(toast.error).toHaveBeenCalledWith(
      "Microphone access failed. Check System Settings -> Privacy & Security -> Microphone.",
    );
    expect(voice.isListening).toBe(false);

    platform.linux = true;
    await toggle();
    await act(async () => recognition().onerror!({ error: "service-not-allowed" }));
    expect(toast.error).toHaveBeenLastCalledWith(
      "Voice input is unavailable because the Linux webview does not provide speech recognition.",
    );
  });

  it("stays quiet on expected aborts and reports other failures", async () => {
    await render();
    await toggle();
    await act(async () => recognition().onerror!({ error: "no-speech" }));
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => recognition().onerror!({ error: "network" }));
    expect(toast.error).toHaveBeenCalledWith("Voice input stopped unexpectedly.");
  });

  it("reports a microphone that cannot be opened", async () => {
    platform.linux = true;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new Error("denied"));
    await render();
    await toggle();
    expect(toast.error).toHaveBeenCalledWith(
      "Microphone access failed. Check your PipeWire/PulseAudio input device and unmute the default microphone.",
    );
    expect(FakeRecognition.instances).toHaveLength(0);
  });

  it("reports a recognizer that refuses to start", async () => {
    Object.assign(window, {
      SpeechRecognition: class extends FakeRecognition {
        start = vi.fn(() => {
          throw new Error("busy");
        });
      },
    });
    await render();
    await toggle();
    expect(toast.error).toHaveBeenCalledWith("Voice input could not be started.");
    expect(voice.isListening).toBe(false);
  });

  it("does nothing when disabled and warns without speech support", async () => {
    await render(false);
    await toggle();
    expect(FakeRecognition.instances).toHaveLength(0);

    Reflect.deleteProperty(window, "SpeechRecognition");
    await render(true);
    expect(voice.isSupported).toBe(false);
    await toggle();
    expect(toast.warning).toHaveBeenCalledWith("Voice input is not supported in this webview.");
  });

  it("is blocked in macOS dev builds", async () => {
    platform.mac = true;
    await render();
    expect(voice.isMacDevBlocked).toBe(true);
    await toggle();
    expect(toast.warning).toHaveBeenCalledWith(
      "Voice input is disabled in macOS dev mode. Test it in a packaged app build.",
    );
  });

  it("aborts recognition on unmount", async () => {
    await render();
    await toggle();
    const active = recognition();
    await act(async () => root.unmount());
    expect(active.abort).toHaveBeenCalled();
    root = createRoot(document.createElement("div"));
  });
});
