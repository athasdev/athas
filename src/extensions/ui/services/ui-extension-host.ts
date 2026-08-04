import { invoke } from "@tauri-apps/api/core";
import { createElement } from "react";
import type { ExtensionManifest } from "@/extensions/types/extension-manifest";
import { ExternalExtensionView } from "../components/external-extension-view";
import { useUIExtensionStore } from "../stores/ui-extension-store";
import type { ExtensionViewNode } from "../types/extension-view";
import { callExtensionHostService } from "./extension-host-services";
import type { ExtensionWorkerMessage } from "./ui-extension-worker";

interface LoadedExtension {
  extensionId: string;
  manifest: ExtensionManifest;
  worker?: Worker;
  entryPointUrl?: string;
  nextRequestId: number;
  pending: Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: number }
  >;
}

const REQUEST_TIMEOUT_MS = 30_000;

function assertNamespaced(extensionId: string, contributionId: unknown): string {
  const id = String(contributionId);
  if (!id.startsWith(`${extensionId}.`)) {
    throw new Error(`Extension contribution ids must start with ${extensionId}.`);
  }
  return id;
}

class UIExtensionHost {
  private loaded = new Map<string, LoadedExtension>();

  async loadExtension(manifest: ExtensionManifest, _extensionPath?: string): Promise<void> {
    const extensionId = manifest.id;
    if (this.loaded.has(extensionId)) return;

    const actions = useUIExtensionStore.getState().actions;
    actions.registerExtension({ extensionId, manifestId: extensionId, state: "loading" });

    const loaded: LoadedExtension = {
      extensionId,
      manifest,
      nextRequestId: 1,
      pending: new Map(),
    };
    this.loaded.set(extensionId, loaded);

    try {
      if (!manifest.main) {
        actions.updateExtensionState(extensionId, "active");
        return;
      }

      const source = await invoke<string>("read_extension_entrypoint", {
        extensionId,
        entrypoint: manifest.main,
      });
      loaded.entryPointUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
      const worker = new Worker(new URL("./ui-extension-worker-runtime.ts", import.meta.url), {
        type: "module",
        name: extensionId,
      });
      loaded.worker = worker;
      worker.addEventListener("message", (event: MessageEvent<ExtensionWorkerMessage>) => {
        void this.handleMessage(loaded, event.data);
      });
      worker.addEventListener("error", (event) => {
        actions.updateExtensionState(extensionId, "error", event.message);
      });
      worker.postMessage({ type: "activate", entryPointUrl: loaded.entryPointUrl });

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Extension activation timed out")),
          REQUEST_TIMEOUT_MS,
        );
        const onReady = (event: MessageEvent<ExtensionWorkerMessage>) => {
          if (event.data.type !== "event") return;
          if (event.data.event !== "ready" && event.data.event !== "activation.error") return;
          window.clearTimeout(timeout);
          worker.removeEventListener("message", onReady);
          worker.removeEventListener("error", onError);
          if (event.data.event === "activation.error") {
            reject(new Error(String(event.data.payload?.message ?? "Extension activation failed")));
          } else {
            resolve();
          }
        };
        const onError = (event: ErrorEvent) => {
          window.clearTimeout(timeout);
          worker.removeEventListener("message", onReady);
          worker.removeEventListener("error", onError);
          reject(new Error(event.message || "Extension activation failed"));
        };
        worker.addEventListener("message", onReady);
        worker.addEventListener("error", onError);
      });
      actions.updateExtensionState(extensionId, "active");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      actions.updateExtensionState(extensionId, "error", message);
      this.disposeWorker(loaded);
      this.loaded.delete(extensionId);
      throw error;
    }
  }

  private async handleMessage(loaded: LoadedExtension, message: ExtensionWorkerMessage) {
    if (message.type === "response") {
      const pending = loaded.pending.get(message.id);
      if (!pending) return;
      loaded.pending.delete(message.id);
      window.clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
      return;
    }

    if (message.type === "host-call") {
      try {
        const result = await callExtensionHostService(
          loaded.extensionId,
          loaded.manifest,
          message.method,
          message.params,
        );
        loaded.worker?.postMessage({ type: "response", id: message.id, result });
      } catch (error) {
        loaded.worker?.postMessage({
          type: "response",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const payload = message.payload ?? {};
    const actions = useUIExtensionStore.getState().actions;
    if (message.event === "sidebar.registerView") {
      const id = assertNamespaced(loaded.extensionId, payload.id);
      actions.registerSidebarView({
        id,
        extensionId: loaded.extensionId,
        title: String(payload.title ?? id),
        icon: String(payload.icon ?? "puzzle-piece"),
        order: typeof payload.order === "number" ? payload.order : undefined,
        render: () =>
          createElement(ExternalExtensionView, { extensionId: loaded.extensionId, viewId: id }),
      });
    } else if (message.event === "commands.register") {
      const id = assertNamespaced(loaded.extensionId, payload.id);
      actions.registerCommand({
        id,
        extensionId: loaded.extensionId,
        title: String(payload.title ?? id),
        category: typeof payload.category === "string" ? payload.category : undefined,
        execute: (...args) => this.executeCommand(loaded.extensionId, id, args),
      });
    } else if (message.event === "views.invalidate") {
      actions.invalidateSidebarView(assertNamespaced(loaded.extensionId, payload.viewId));
    }
  }

  private request(extensionId: string, method: string, params: unknown[]): Promise<unknown> {
    const loaded = this.loaded.get(extensionId);
    if (!loaded?.worker) return Promise.reject(new Error(`Extension ${extensionId} is not active`));
    const id = loaded.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        loaded.pending.delete(id);
        reject(new Error(`Extension request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      loaded.pending.set(id, { resolve, reject, timeout });
      loaded.worker?.postMessage({ type: "worker-call", id, method, params });
    });
  }

  async renderView(extensionId: string, viewId: string): Promise<ExtensionViewNode> {
    return (await this.request(extensionId, "renderView", [viewId])) as ExtensionViewNode;
  }

  async executeCommand(
    extensionId: string,
    commandId: string,
    args: unknown[] = [],
  ): Promise<void> {
    await this.request(extensionId, "executeCommand", [commandId, ...args]);
  }

  async unloadExtension(extensionId: string): Promise<void> {
    const loaded = this.loaded.get(extensionId);
    if (!loaded) return;
    if (loaded.worker) {
      await this.request(extensionId, "deactivate", []).catch(() => undefined);
    }
    this.disposeWorker(loaded);
    useUIExtensionStore.getState().actions.cleanupExtension(extensionId);
    this.loaded.delete(extensionId);
  }

  private disposeWorker(loaded: LoadedExtension) {
    loaded.worker?.terminate();
    if (loaded.entryPointUrl) URL.revokeObjectURL(loaded.entryPointUrl);
    for (const request of loaded.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(new Error("Extension was unloaded"));
    }
    loaded.pending.clear();
  }

  isLoaded(extensionId: string): boolean {
    return this.loaded.has(extensionId);
  }
}

export const uiExtensionHost = new UIExtensionHost();
