import { commands } from "@/bindings/commands";
import { showConfirmDialog } from "@/ui/dialog";

interface HostReview {
  promise: Promise<void>;
  controller: AbortController;
  consumers: number;
}
const pendingReviews = new Map<string, HostReview>();

function waitForReview(promise: Promise<void>, signal?: AbortSignal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
const prefix = "ATHAS_SSH_UNKNOWN_HOST:";

export function parseHostTrustChallenge(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.startsWith(prefix)) return null;
  try {
    const value: unknown = JSON.parse(message.slice(prefix.length));
    if (
      typeof value !== "object" ||
      value === null ||
      !("host" in value) ||
      !("port" in value) ||
      !("fingerprint" in value) ||
      typeof value.host !== "string" ||
      !value.host ||
      [...value.host].some(
        (character) =>
          /\s/.test(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      typeof value.port !== "number" ||
      !Number.isInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535 ||
      typeof value.fingerprint !== "string" ||
      !/^SHA256:[A-Za-z0-9+/]{43}$/.test(value.fingerprint)
    ) {
      return null;
    }
    return { host: value.host, port: value.port, fingerprint: value.fingerprint };
  } catch {
    return null;
  }
}

export async function withRemoteHostTrust<T>(
  endpoint: { host: string; port: number },
  connect: () => Promise<T>,
  { signal }: { signal?: AbortSignal } = {},
): Promise<T> {
  signal?.throwIfAborted();
  try {
    return await connect();
  } catch (error) {
    signal?.throwIfAborted();
    const challenge = parseHostTrustChallenge(error);
    if (!challenge) throw error;
    const reviewKey = JSON.stringify([endpoint.host, endpoint.port, challenge.fingerprint]);
    let review = pendingReviews.get(reviewKey);
    if (!review) {
      const controller = new AbortController();
      review = {
        controller,
        consumers: 0,
        promise: (async () => {
          const accepted = await showConfirmDialog(
            `This is your first connection to ${challenge.host}:${challenge.port}. Verify this server fingerprint with your administrator before trusting it: ${challenge.fingerprint}`,
            {
              title: "Trust SSH server?",
              confirmLabel: "Trust and connect",
              cancelLabel: "Cancel",
              signal: controller.signal,
            },
          );
          controller.signal.throwIfAborted();
          if (!accepted) throw new Error("SSH server trust was cancelled.");
          await commands.sshTrustHost(endpoint.host, endpoint.port, challenge.fingerprint);
        })(),
      };
      pendingReviews.set(reviewKey, review);
    }
    review.consumers += 1;
    try {
      await waitForReview(review.promise, signal);
      signal?.throwIfAborted();
    } finally {
      review.consumers -= 1;
      if (review.consumers === 0) {
        review.controller.abort();
        if (pendingReviews.get(reviewKey) === review) pendingReviews.delete(reviewKey);
      }
    }
    try {
      return await connect();
    } catch (retryError) {
      if (parseHostTrustChallenge(retryError)) {
        throw new Error(
          "SSH server trust changed during connection. Reconnect to verify its identity.",
        );
      }
      throw retryError;
    }
  }
}
