import { describe, expect, it, vi } from "vite-plus/test";
import {
  createDevServerAutoOpener,
  createTypingTracker,
  DEV_SERVER_PROBE_DELAYS_MS,
  type DevServerAutoOpenDependencies,
} from "../services/dev-server-auto-open";

function setup(overrides: Partial<DevServerAutoOpenDependencies> = {}) {
  const opened = new Map<string, string>();
  const waits: number[] = [];
  const dependencies: DevServerAutoOpenDependencies = {
    isReachable: vi.fn(async () => true),
    isUserTyping: () => false,
    wait: async (ms) => {
      waits.push(ms);
    },
    hasAutoOpened: (chatId) => opened.has(chatId),
    markReachable: vi.fn(),
    open: vi.fn((chatId: string, url: string) => {
      opened.set(chatId, url);
    }),
    ...overrides,
  };
  return { opener: createDevServerAutoOpener(dependencies), dependencies, opened, waits };
}

describe("dev server auto-open", () => {
  it("opens the browser once the server answers", async () => {
    const { opener, opened } = setup();
    await expect(opener.consider("a", "http://localhost:5173/")).resolves.toBe(true);
    expect(opened.get("a")).toBe("http://localhost:5173/");
  });

  it("opens once per session, while other sessions still open", async () => {
    const { opener, dependencies } = setup();
    await opener.consider("a", "http://localhost:5173/");
    await expect(opener.consider("a", "http://localhost:3000/")).resolves.toBe(false);
    await expect(opener.consider("b", "http://localhost:3000/")).resolves.toBe(true);
    expect(dependencies.open).toHaveBeenCalledTimes(2);
  });

  it("marks a server live even when the browser already opened, and checks it once", async () => {
    const { opener, dependencies } = setup();
    await opener.consider("a", "http://localhost:5173/");
    await opener.consider("a", "http://localhost:3000/");
    await opener.consider("a", "http://localhost:3000/");
    expect(dependencies.markReachable).toHaveBeenCalledTimes(2);
    expect(dependencies.markReachable).toHaveBeenLastCalledWith("a", "http://localhost:3000/");
    expect(dependencies.isReachable).toHaveBeenCalledTimes(2);
    expect(dependencies.open).toHaveBeenCalledTimes(1);
  });

  it("checks an address once at a time", async () => {
    const { opener, dependencies } = setup();
    const [first, second] = await Promise.all([
      opener.consider("a", "http://localhost:5173/"),
      opener.consider("a", "http://localhost:5173/"),
    ]);
    expect([first, second]).toEqual([true, false]);
    expect(dependencies.open).toHaveBeenCalledTimes(1);
  });

  it("retries while the server starts and gives up when it never answers", async () => {
    const isReachable = vi.fn(async () => false);
    const { opener, dependencies, waits } = setup({ isReachable });
    await expect(opener.consider("a", "http://localhost:5173/")).resolves.toBe(false);
    expect(isReachable).toHaveBeenCalledTimes(DEV_SERVER_PROBE_DELAYS_MS.length);
    expect(waits).toEqual(DEV_SERVER_PROBE_DELAYS_MS.filter((delay) => delay > 0));
    expect(dependencies.open).not.toHaveBeenCalled();

    isReachable.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(opener.consider("a", "http://localhost:5173/")).resolves.toBe(true);
  });

  it("waits until the user stops typing before it opens", async () => {
    let typing = 3;
    const order: string[] = [];
    const { opener } = setup({
      isUserTyping: () => {
        order.push(typing > 0 ? "typing" : "idle");
        return typing-- > 0;
      },
      open: () => order.push("open"),
    });
    await opener.consider("a", "http://localhost:5173/");
    expect(order).toEqual(["typing", "typing", "typing", "idle", "open"]);
  });

  it("drops the open when the session opened meanwhile", async () => {
    let opened = false;
    const { opener, dependencies } = setup({
      isUserTyping: () => {
        opened = true;
        return false;
      },
      hasAutoOpened: () => opened,
    });
    await expect(opener.consider("a", "http://localhost:5173/")).resolves.toBe(false);
    expect(dependencies.open).not.toHaveBeenCalled();
  });
});

describe("typing tracker", () => {
  function fakeWindow() {
    const target = new EventTarget();
    return {
      target,
      window: {
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
      } as unknown as Window,
    };
  }

  function keydown(target: EventTarget, element: Partial<HTMLElement>) {
    const event = new Event("keydown");
    Object.defineProperty(event, "target", { value: element });
    target.dispatchEvent(event);
  }

  it("counts keystrokes in editable fields until the user pauses", () => {
    let now = 1_000;
    const { target, window } = fakeWindow();
    const tracker = createTypingTracker(window, () => now, 1_500);

    keydown(target, { tagName: "DIV", isContentEditable: false });
    expect(tracker.isTyping()).toBe(false);

    keydown(target, { tagName: "TEXTAREA", isContentEditable: false });
    expect(tracker.isTyping()).toBe(true);
    now += 1_499;
    expect(tracker.isTyping()).toBe(true);
    now += 1;
    expect(tracker.isTyping()).toBe(false);

    keydown(target, { tagName: "DIV", isContentEditable: true });
    expect(tracker.isTyping()).toBe(true);
    tracker.dispose();
  });
});
