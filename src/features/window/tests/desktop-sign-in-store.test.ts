import { describe, expect, it, vi } from "vite-plus/test";
import type { beginDesktopAuthSession } from "../services/auth-api";
import { createDesktopSignInStore } from "../stores/desktop-sign-in.store";

function setup() {
  const ready = Promise.withResolvers<string>();
  const dependencies = {
    begin: vi.fn<typeof beginDesktopAuthSession>(async () => ({
      sessionId: "session",
      pollSecret: "secret",
      loginUrl: "http://localhost:3000/auth/desktop?desktop_session=session",
      apiBase: "http://localhost:3000",
    })),
    open: vi.fn(async () => {}),
    wait: vi.fn(() => ready.promise),
    complete: vi.fn(async () => {}),
  };
  return { ready, dependencies, store: createDesktopSignInStore(dependencies) };
}

describe("shared desktop sign-in", () => {
  it("uses one browser session and one poll loop across entry points", async () => {
    const { store, dependencies, ready } = setup();
    const first = store.getState().actions.signIn();
    const second = store.getState().actions.signIn();
    expect(first).toBe(second);
    expect(store.getState().isSigningIn).toBe(true);
    await vi.waitFor(() => expect(dependencies.wait).toHaveBeenCalledOnce());
    ready.resolve("desktop-token");
    expect(await first).toBe(true);
    expect(dependencies.begin).toHaveBeenCalledOnce();
    expect(dependencies.open).toHaveBeenCalledOnce();
    expect(dependencies.complete).toHaveBeenCalledExactlyOnceWith("desktop-token");
    expect(store.getState().isSigningIn).toBe(false);
  });

  it("reopens the same pending session without starting another poll", async () => {
    const { store, dependencies, ready } = setup();
    const pending = store.getState().actions.signIn();
    await vi.waitFor(() => expect(dependencies.wait).toHaveBeenCalledOnce());
    await store.getState().actions.reopen();
    expect(dependencies.open).toHaveBeenCalledTimes(2);
    expect(dependencies.open.mock.calls[0]).toEqual(dependencies.open.mock.calls[1]);
    expect(dependencies.begin).toHaveBeenCalledOnce();
    ready.resolve("token");
    await pending;
  });

  it("never authenticates a canceled attempt even if a poll resolves late", async () => {
    const { store, dependencies, ready } = setup();
    const pending = store.getState().actions.signIn();
    await vi.waitFor(() => expect(dependencies.wait).toHaveBeenCalledOnce());
    const signal = dependencies.begin.mock.calls[0][0]?.signal;
    store.getState().actions.cancel();
    expect(signal?.aborted).toBe(true);
    ready.resolve("old-token");
    expect(await pending).toBe(false);
    expect(dependencies.complete).not.toHaveBeenCalled();
    expect(store.getState().isSigningIn).toBe(false);
  });

  it("keeps the real failure available to every sign-in surface", async () => {
    const { store, dependencies } = setup();
    dependencies.begin.mockRejectedValue(new Error("Local auth server unavailable"));
    expect(await store.getState().actions.signIn()).toBe(false);
    expect(store.getState().error).toBe("Local auth server unavailable");
    expect(store.getState().isSigningIn).toBe(false);
  });
});
