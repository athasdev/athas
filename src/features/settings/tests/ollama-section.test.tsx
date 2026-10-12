// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    toasts: [] as { type: string; message: string }[],
    reachable: new Set<string>(),
    requests: [] as { url: string; authorization?: string }[],
  };
});

vi.mock("sonner", () => {
  const record = (type: string) => (message: string) => mocks.toasts.push({ type, message });
  return {
    toast: Object.assign(record("info"), {
      error: record("error"),
      success: record("success"),
      info: record("info"),
      warning: record("warning"),
    }),
  };
});
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
    mocks.requests.push({ url, authorization: init?.headers?.Authorization });
    return { ok: mocks.reachable.has(new URL(url).origin) };
  },
}));

import { commands } from "@/bindings/commands";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { OllamaSection } from "../components/ai/ollama-section";
import { getDefaultSettingsSnapshot } from "../config/default-settings";
import { useSettingsStore } from "../stores/settings.store";

enableMapSet();

const last = <T,>(items: T[]) => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
let storedToken: string | null;

const body = () => within(document.body);
const baseUrl = () => useSettingsStore.getState().settings.ollamaBaseUrl;
const addressInput = () => body().getByLabelText("Ollama server address") as HTMLInputElement;
const status = () =>
  document
    .querySelector('[data-setting-row-label="Server address"] [role="img"]')!
    .getAttribute("aria-label");

function rowDescription(label: string) {
  const row = document.querySelector(`[data-setting-row-label="${label}"]`)!;
  const id = row.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : null;
}

function button(text: string) {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  );
  if (!match) throw new Error(`No button labelled ${text}`);
  return match;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await flush();
}

async function render() {
  await act(async () => root.render(<OllamaSection />));
  await flush();
}

async function commitAddress(value: string) {
  await act(async () => {
    addressInput().focus();
    fireEvent.change(addressInput(), { target: { value } });
  });
  await act(async () => {
    fireEvent.keyDown(addressInput(), { key: "Enter" });
  });
  await flush();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useSettingsStore.setState({ settings: getDefaultSettingsSnapshot() });
  mocks.toasts.length = 0;
  mocks.requests.length = 0;
  mocks.reachable.clear();
  storedToken = null;
  vi.spyOn(commands, "getAiProviderToken").mockImplementation(async () => storedToken);
  vi.spyOn(commands, "storeAiProviderToken").mockImplementation(async (_provider, token) => {
    storedToken = token;
    return null as never;
  });
  vi.spyOn(commands, "removeAiProviderToken").mockImplementation(async () => {
    storedToken = null;
    return null as never;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Ollama settings", () => {
  it("normalizes and saves a LAN address, then checks the server", async () => {
    mocks.reachable.add("http://192.168.1.20:11434");
    await render();
    expect(status()).toBe("Not checked");

    await commitAddress("192.168.1.20:11434/");

    expect(baseUrl()).toBe("http://192.168.1.20:11434");
    expect(addressInput().value).toBe("http://192.168.1.20:11434");
    expect(last(mocks.requests)?.url).toBe("http://192.168.1.20:11434/api/tags");
    expect(status()).toBe("Connected");
    expect(rowDescription("Server address")).toBe("Connected");
  });

  it("commits a typed address after a pause", async () => {
    await render();

    await act(async () => {
      fireEvent.change(addressInput(), { target: { value: "gpu.example.com:11434" } });
    });
    expect(baseUrl()).toBe("http://localhost:11434");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
    });
    await flush();

    expect(baseUrl()).toBe("http://gpu.example.com:11434");
    expect(rowDescription("Server address")).toBe(
      "Could not connect. Is Ollama running at this address?",
    );
  });

  it("warns that a reachable remote server is outside the local network", async () => {
    mocks.reachable.add("http://gpu.example.com:11434");
    await render();

    await commitAddress("gpu.example.com:11434");

    expect(status()).toBe("Connected");
    expect(rowDescription("Server address")).toBe("Runs outside your local network");
  });

  it("rejects an address that is not an http endpoint without saving it", async () => {
    await render();

    await commitAddress("ftp://ollama.lan");

    expect(baseUrl()).toBe("http://localhost:11434");
    expect(status()).toBe("Not reachable");
    expect(addressInput().getAttribute("aria-invalid")).toBe("true");
    expect(mocks.requests).toEqual([]);
  });

  it("resets a custom address to the default", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, ollamaBaseUrl: "http://10.0.0.8:11434" },
    }));
    mocks.reachable.add("http://localhost:11434");
    await render();
    expect(addressInput().value).toBe("http://10.0.0.8:11434");

    await click(body().getByRole("button", { name: "Reset Ollama address to default" }));

    expect(baseUrl()).toBe("http://localhost:11434");
    expect(status()).toBe("Connected");
    expect(body().queryByRole("button", { name: "Reset Ollama address to default" })).toBeNull();
  });

  it("switches to Ollama Cloud, saves a key, and returns to the local server", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, ollamaBaseUrl: "http://10.0.0.8:11434" },
    }));
    mocks.reachable.add("https://ollama.com");
    await render();
    expect(body().queryByLabelText("Ollama API key")).toBeNull();

    await click(button("Cloud"));
    expect(baseUrl()).toBe("https://ollama.com");
    expect(rowDescription("API key")).toContain("Get a key at");
    expect(button("Save").disabled).toBe(true);

    await act(async () => {
      fireEvent.change(body().getByLabelText("Ollama API key"), {
        target: { value: "  sk-ollama  " },
      });
    });
    await act(async () => {
      fireEvent.keyDown(body().getByLabelText("Ollama API key"), { key: "Enter" });
    });
    await flush();

    expect(storedToken).toBe("sk-ollama");
    expect(mocks.toasts).toContainEqual({ type: "success", message: "Ollama API key saved" });
    expect(rowDescription("API key")).toBe("Configured");
    expect(last(mocks.requests)).toEqual({
      url: "https://ollama.com/api/tags",
      authorization: "Bearer sk-ollama",
    });
    expect(status()).toBe("Connected");

    await click(button("Local"));
    expect(baseUrl()).toBe("http://10.0.0.8:11434");
    expect(last(mocks.requests)).toEqual({
      url: "http://10.0.0.8:11434/api/tags",
      authorization: "Bearer sk-ollama",
    });
  });

  it("explains an unreachable Ollama Cloud", async () => {
    await render();

    await click(button("Cloud"));

    expect(status()).toBe("Not reachable");
    expect(rowDescription("Server address")).toBe(
      "Could not reach Ollama Cloud. Check your key and connection.",
    );
  });

  it("removes a stored key", async () => {
    storedToken = "sk-old";
    await render();

    expect(rowDescription("API key")).toBe("Configured");
    await click(button("Reset Key"));

    expect(storedToken).toBeNull();
    expect(mocks.toasts).toContainEqual({ type: "success", message: "Ollama API key removed" });
    expect(document.querySelector('[data-setting-row-label="API key"]')).toBeNull();
  });

  it("reports key storage failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    storedToken = "sk-old";
    vi.mocked(commands.removeAiProviderToken).mockRejectedValueOnce(new Error("keychain locked"));
    await render();

    await click(button("Reset Key"));
    expect(mocks.toasts).toContainEqual({
      type: "error",
      message: "Failed to remove Ollama API key",
    });
    expect(rowDescription("API key")).toBe("Configured");

    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, ollamaBaseUrl: "https://ollama.com" },
    }));
    storedToken = null;
    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    vi.mocked(commands.storeAiProviderToken).mockRejectedValueOnce(new Error("keychain locked"));
    await act(async () => {
      fireEvent.change(body().getByLabelText("Ollama API key"), { target: { value: "sk-new" } });
    });
    await click(button("Save"));

    expect(mocks.toasts).toContainEqual({
      type: "error",
      message: "Failed to save Ollama API key",
    });
    expect(storedToken).toBeNull();
  });
});
