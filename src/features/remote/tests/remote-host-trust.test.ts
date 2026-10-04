import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { parseHostTrustChallenge, withRemoteHostTrust } from "../services/remote-host-trust";
import { getFriendlyRemoteError, isRemoteAuthFailure } from "../utils/remote-errors";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/ui/dialog", () => ({ showConfirmDialog: mocks.confirm }));

const fingerprint = "SHA256:LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ";
const challenge = `ATHAS_SSH_UNKNOWN_HOST:${JSON.stringify({ host: "server.example.com", port: 2222, fingerprint })}`;
const endpoint = { host: "server-alias", port: 22, password: "private-password" };

describe("SSH server trust", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.confirm.mockResolvedValue(true);
    mocks.invoke.mockResolvedValue(undefined);
  });

  it("connects directly when the native backend already trusts the server", async () => {
    const connect = vi.fn().mockResolvedValue("connected");
    await expect(withRemoteHostTrust(endpoint, connect)).resolves.toBe("connected");
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("reviews the resolved endpoint and fingerprint before persisting and retrying once", async () => {
    const connect = vi.fn().mockRejectedValueOnce(challenge).mockResolvedValue("connected");
    await expect(withRemoteHostTrust(endpoint, connect)).resolves.toBe("connected");
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.stringContaining(`server.example.com:2222`),
      expect.objectContaining({ confirmLabel: "Trust and connect" }),
    );
    expect(mocks.confirm.mock.calls[0][0]).toContain(fingerprint);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("ssh_trust_host", {
      host: "server-alias",
      port: 22,
      fingerprint,
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.confirm.mock.invocationCallOrder[0],
    );
    expect(connect.mock.invocationCallOrder[1]).toBeGreaterThan(
      mocks.invoke.mock.invocationCallOrder[0],
    );
  });

  it("never retries authentication when review is cancelled or persistence fails", async () => {
    mocks.confirm.mockResolvedValueOnce(false);
    const cancelled = vi.fn().mockRejectedValue(challenge);
    await expect(withRemoteHostTrust(endpoint, cancelled)).rejects.toThrow("cancelled");
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockRejectedValueOnce(new Error("Could not save SSH server trust"));
    const failed = vi.fn().mockRejectedValue(challenge);
    await expect(withRemoteHostTrust(endpoint, failed)).rejects.toThrow(
      "Could not save SSH server trust",
    );
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("shares a concurrent trust review and retries each operation only after it succeeds", async () => {
    let accept: (value: boolean) => void = () => {};
    mocks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const first = vi.fn().mockRejectedValueOnce(challenge).mockResolvedValue("file");
    const second = vi.fn().mockRejectedValueOnce(challenge).mockResolvedValue("terminal");
    const firstResult = withRemoteHostTrust(endpoint, first);
    const secondResult = withRemoteHostTrust(endpoint, second);
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    accept(true);
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual(["file", "terminal"]);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not approve changed keys or hide the repair instructions behind a password error", async () => {
    const error = new Error(
      "Host key verification failed: the server key changed. Repair /home/user/.ssh/known_hosts.",
    );
    const connect = vi.fn().mockRejectedValue(error);
    await expect(withRemoteHostTrust(endpoint, connect)).rejects.toBe(error);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(isRemoteAuthFailure(error)).toBe(false);
    expect(getFriendlyRemoteError(error)).toBe(error.message);
    const permissions = new Error(
      "Cannot read SSH trusted hosts /home/user/.ssh/known_hosts: Permission denied",
    );
    expect(isRemoteAuthFailure(permissions)).toBe(false);
    expect(getFriendlyRemoteError(permissions)).toBe(permissions.message);
  });

  it("does not loop when the key is unknown again after an approved retry", async () => {
    const connect = vi.fn().mockRejectedValue(challenge);
    await expect(withRemoteHostTrust(endpoint, connect)).rejects.toThrow(
      "SSH server trust changed during connection",
    );
    expect(connect).toHaveBeenCalledTimes(2);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it("withdraws a review when its last caller closes without trusting or reconnecting", async () => {
    mocks.confirm.mockImplementation(
      (message, { signal }) =>
        new Promise<boolean>((resolve) => {
          signal.addEventListener("abort", () => resolve(false), { once: true });
        }),
    );
    const lifetime = new AbortController();
    const connect = vi.fn().mockRejectedValue(challenge);
    const result = withRemoteHostTrust(endpoint, connect, { signal: lifetime.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    const reviewSignal = mocks.confirm.mock.calls[0][1].signal;
    lifetime.abort();
    await rejected;
    expect(reviewSignal.aborted).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps a shared review open for remaining callers when one terminal closes", async () => {
    let accept: (value: boolean) => void = () => {};
    mocks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          accept = resolve;
        }),
    );
    const lifetime = new AbortController();
    const cancelled = vi.fn().mockRejectedValue(challenge);
    const live = vi.fn().mockRejectedValueOnce(challenge).mockResolvedValue("connected");
    const closed = withRemoteHostTrust(endpoint, cancelled, { signal: lifetime.signal });
    const rejected = expect(closed).rejects.toMatchObject({ name: "AbortError" });
    const connected = withRemoteHostTrust(endpoint, live);
    await vi.waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    lifetime.abort();
    await rejected;
    expect(mocks.confirm.mock.calls[0][1].signal.aborted).toBe(false);
    accept(true);
    await expect(connected).resolves.toBe("connected");
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed or injected challenges", () => {
    expect(parseHostTrustChallenge(new Error(challenge))).toEqual({
      host: "server.example.com",
      port: 2222,
      fingerprint,
    });
    for (const value of [
      null,
      {},
      { host: "host", port: 0, fingerprint },
      { host: "host", port: 22.5, fingerprint },
      { host: "host\nother", port: 22, fingerprint },
      { host: "host", port: 22, fingerprint: "SHA256:bad" },
    ]) {
      expect(parseHostTrustChallenge(`ATHAS_SSH_UNKNOWN_HOST:${JSON.stringify(value)}`)).toBeNull();
    }
    expect(parseHostTrustChallenge("ATHAS_SSH_UNKNOWN_HOST:{")).toBeNull();
    expect(parseHostTrustChallenge("Authentication failed")).toBeNull();
  });
});
