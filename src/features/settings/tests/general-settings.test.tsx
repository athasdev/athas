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
    check: vi.fn(),
    relaunch: vi.fn(async () => {}),
    openUrl: vi.fn(async (_url: string) => {}),
    writeText: vi.fn(async (_text: string) => {}),
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
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.4.0" }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos", version: () => "15.1" }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: mocks.writeText }));
vi.mock("@/features/telemetry/services/telemetry", () => ({
  recordUpdateCheckTelemetry: vi.fn(async () => true),
}));

import { commands } from "@/bindings/commands";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { GeneralSettings } from "../components/tabs/general-settings";

enableMapSet();

let root: Root;
let container: HTMLDivElement;

const body = () => within(document.body);

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
  await act(async () => root.render(<GeneralSettings />));
  await flush();
}

function rowDescription(label: string) {
  const row = document.querySelector(`[data-setting-row-label="${label}"]`)!;
  const id = row.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : null;
}

function spyCli(installed: boolean) {
  vi.spyOn(commands, "checkCliInstalled").mockResolvedValue(installed);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  mocks.toasts.length = 0;
  mocks.check.mockReset();
  mocks.openUrl.mockClear();
  mocks.writeText.mockClear();
  vi.spyOn(commands, "appUpdateMode").mockResolvedValue("self");
  Element.prototype.getAnimations = () => [];
  Element.prototype.scrollIntoView = () => {};
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

describe("general settings", () => {
  it("reports an up-to-date app when no update is available", async () => {
    spyCli(false);
    mocks.check.mockResolvedValue({ available: false, currentVersion: "1.4.0" });
    await render();

    expect(rowDescription("Version")).toBe("Athas 1.4.0 · Up to date");
    await click(button("Check for updates"));

    expect(mocks.toasts).toContainEqual({
      type: "success",
      message: "You're on the latest version",
    });
  });

  it("offers to install an available update and shows a failed check", async () => {
    spyCli(false);
    mocks.check.mockResolvedValueOnce({
      available: true,
      version: "2.0.0",
      currentVersion: "1.4.0",
      rawJson: {},
    });
    await render();

    await click(button("Check for updates"));
    expect(rowDescription("Version")).toBe("Athas 1.4.0 · 2.0.0 available");
    expect(button("Install 2.0.0")).toBeTruthy();
    expect(mocks.toasts).toEqual([]);
  });

  it("surfaces an update check error", async () => {
    spyCli(false);
    mocks.check.mockRejectedValue(new Error("network unreachable"));
    await render();

    await click(button("Check for updates"));

    expect(rowDescription("Version")).toBe("Athas 1.4.0 · Update check failed");
    expect(body().getByText("network unreachable")).toBeTruthy();
  });

  it("installs the shell command and reports the result", async () => {
    spyCli(false);
    vi.spyOn(commands, "installCliCommand").mockResolvedValue("Installed athas");
    await render();

    expect(rowDescription("Shell Command")).toBe("Open folders from your shell with athas");
    await click(button("Install"));

    expect(mocks.toasts).toContainEqual({ type: "success", message: "Installed athas" });
    expect(rowDescription("Shell Command")).toBe("Installed at ~/.local/bin/athas");
    expect(button("Uninstall")).toBeTruthy();
  });

  it("explains a failed shell command install", async () => {
    spyCli(false);
    vi.spyOn(commands, "installCliCommand").mockRejectedValue("permission denied");
    await render();

    await click(button("Install"));

    expect(mocks.toasts).toContainEqual({
      type: "error",
      message: "Failed to install CLI: permission denied. You may need administrator privileges.",
    });
    expect(rowDescription("Shell Command")).toBe("Open folders from your shell with athas");
  });

  it("copies the manual install command", async () => {
    spyCli(false);
    vi.spyOn(commands, "getCliInstallCommand").mockResolvedValue("ln -s /app/athas ~/bin");
    await render();

    await click(button("Copy"));

    expect(mocks.writeText).toHaveBeenCalledWith("ln -s /app/athas ~/bin");
    expect(mocks.toasts).toContainEqual({
      type: "success",
      message: "Install command copied to clipboard",
    });
  });

  it("requires typing yes before uninstalling the shell command", async () => {
    spyCli(true);
    const uninstall = vi.spyOn(commands, "uninstallCliCommand").mockResolvedValue("Removed athas");
    await render();

    expect(rowDescription("Shell Command")).toBe("Installed at ~/.local/bin/athas");
    await click(button("Uninstall"));
    const confirm = body().getByPlaceholderText("Type 'yes'");
    const uninstallButton = button("Uninstall");
    expect((uninstallButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.change(confirm, { target: { value: "yes" } });
    });
    await click(uninstallButton);

    expect(uninstall).toHaveBeenCalledOnce();
    expect(mocks.toasts).toContainEqual({ type: "success", message: "Removed athas" });
    expect(rowDescription("Shell Command")).toBe("Open folders from your shell with athas");
  });

  it("reports an uninstall failure and keeps the command installed", async () => {
    spyCli(true);
    vi.spyOn(commands, "uninstallCliCommand").mockRejectedValue("busy");
    await render();

    await click(button("Uninstall"));
    await act(async () => {
      fireEvent.change(body().getByPlaceholderText("Type 'yes'"), { target: { value: "YES" } });
    });
    await act(async () => {
      fireEvent.keyDown(body().getByPlaceholderText("Type 'yes'"), { key: "Enter" });
    });
    await flush();

    expect(mocks.toasts).toContainEqual({
      type: "error",
      message: "Failed to uninstall CLI: busy",
    });
    expect(rowDescription("Shell Command")).toBe("Installed at ~/.local/bin/athas");
  });

  it("copies a bug report template and opens the chosen channel", async () => {
    spyCli(false);
    await render();

    await click(button("Report"));
    const input = body().getByPlaceholderText("Report via...");
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await flush();

    expect(mocks.writeText).toHaveBeenCalledWith(
      expect.stringContaining("- App: Athas 1.4.0\n- OS: macos 15.1"),
    );
    expect(mocks.openUrl).toHaveBeenCalledWith(
      "https://github.com/athasdev/athas/issues/new?template=01-bug.yml",
    );
    expect(mocks.toasts).toContainEqual({ type: "success", message: "Report template copied" });
    expect(body().queryByPlaceholderText("Report via...")).toBeNull();
  });

  it("filters report channels and mails the report body", async () => {
    spyCli(false);
    await render();

    await click(button("Report"));
    const input = body().getByPlaceholderText("Report via...");
    await act(async () => {
      fireEvent.change(input, { target: { value: "nothing-like-this" } });
    });
    expect(body().getByText('No report channel matches "nothing-like-this".')).toBeTruthy();

    await act(async () => {
      fireEvent.change(input, { target: { value: "mail" } });
    });
    await click(body().getByRole("button", { name: /Email/ }));

    const [mailto] = mocks.openUrl.mock.calls[0];
    expect(mailto.startsWith("mailto:hey@athas.dev?subject=Athas%20bug%20report&body=")).toBe(true);
    expect(decodeURIComponent(mailto)).toContain("- OS: macos 15.1");
    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it("keeps the report dialog open when the channel cannot be opened", async () => {
    spyCli(false);
    mocks.openUrl.mockRejectedValueOnce(new Error("no handler"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await render();

    await click(button("Report"));
    const input = body().getByPlaceholderText("Report via...");
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowUp" });
    });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await flush();

    expect(mocks.openUrl).toHaveBeenCalledWith("https://discord.gg/DD8F38wFMv");
    expect(mocks.toasts).toContainEqual({ type: "error", message: "Failed to prepare bug report" });
    expect(body().getByPlaceholderText("Report via...")).toBeTruthy();
  });

  it("opens the editor import dialog", async () => {
    spyCli(false);
    vi.spyOn(commands, "getImportableIdeProjects").mockResolvedValue([]);
    await render();

    await click(button("Import"));

    expect(body().getByPlaceholderText("Import from...")).toBeTruthy();
    expect(button("VS Code")).toBeTruthy();
  });
});
