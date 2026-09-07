import { describe, expect, it, vi } from "vite-plus/test";
import type { ToastInput } from "@/features/notifications/types/notifications.types";
import {
  createTerminalCommandNotifier,
  describeTerminalCommandCompletion,
  formatTerminalCommandDuration,
} from "../services/terminal-command-notifications";
import type { TerminalCommandSummary } from "../types/terminal.types";

const command = (overrides: Partial<TerminalCommandSummary> = {}): TerminalCommandSummary => ({
  status: "success",
  exitCode: 0,
  durationMs: 42_000,
  finishedAt: 1_700_000_000_000,
  ...overrides,
});

function createDependencies(overrides: { focused?: boolean; permission?: boolean } = {}) {
  return {
    isEnabled: () => true,
    showToast: vi.fn<(value: ToastInput) => string>(() => "toast"),
    record: vi.fn(),
    isAppFocused: vi.fn(async () => overrides.focused ?? false),
    isPermissionGranted: vi.fn(async () => overrides.permission ?? true),
    sendNative: vi.fn<(options: { title: string; body: string }) => void>(),
  };
}

describe("terminal command notifications", () => {
  it("formats durations for humans", () => {
    expect(formatTerminalCommandDuration(400)).toBe("1s");
    expect(formatTerminalCommandDuration(42_000)).toBe("42s");
    expect(formatTerminalCommandDuration(125_000)).toBe("2m 05s");
    expect(formatTerminalCommandDuration(3_720_000)).toBe("1h 02m");
  });

  it("describes success and failure with exit codes", () => {
    expect(describeTerminalCommandCompletion("build", command())).toEqual({
      message: "Command finished in build",
      description: "Completed in 42s",
      type: "success",
    });
    expect(
      describeTerminalCommandCompletion("build", command({ status: "failure", exitCode: 2 })),
    ).toMatchObject({ message: "Command failed in build", description: "Exit code 2 after 42s" });
  });

  it("stays quiet for short commands and for the terminal the user is looking at", async () => {
    const dependencies = createDependencies({ focused: true });
    const notify = createTerminalCommandNotifier(dependencies);
    const activate = vi.fn();

    await expect(
      notify(
        {
          terminalId: "t1",
          terminalName: "zsh",
          command: command({ durationMs: 2_000 }),
          isTerminalVisible: false,
        },
        activate,
      ),
    ).resolves.toBe(false);
    await expect(
      notify(
        { terminalId: "t1", terminalName: "zsh", command: command(), isTerminalVisible: true },
        activate,
      ),
    ).resolves.toBe(false);
    expect(dependencies.showToast).not.toHaveBeenCalled();
    expect(dependencies.record).not.toHaveBeenCalled();
  });

  it("shows a toast with a jump action when the terminal is hidden", async () => {
    const dependencies = createDependencies({ focused: true });
    const notify = createTerminalCommandNotifier(dependencies);
    const activate = vi.fn();

    await notify(
      { terminalId: "t1", terminalName: "zsh", command: command(), isTerminalVisible: false },
      activate,
    );

    expect(dependencies.record).toHaveBeenCalledWith(
      expect.objectContaining({ category: "athas", type: "success" }),
    );
    const toast = dependencies.showToast.mock.calls[0][0];
    expect(toast.message).toBe("Command finished in zsh");
    toast.action?.onClick();
    expect(activate).toHaveBeenCalledWith("t1");
    expect(dependencies.sendNative).not.toHaveBeenCalled();
  });

  it("adds a native notification when the app is in the background", async () => {
    const dependencies = createDependencies({ focused: false });
    const notify = createTerminalCommandNotifier(dependencies);

    await notify(
      {
        terminalId: "t1",
        terminalName: "zsh",
        command: command({ status: "failure", exitCode: 1 }),
        isTerminalVisible: true,
      },
      vi.fn(),
    );

    expect(dependencies.sendNative).toHaveBeenCalledWith({
      title: "Command failed in zsh",
      body: "Exit code 1 after 42s",
    });
  });

  it("respects the setting and the permission", async () => {
    const disabled = createDependencies();
    await createTerminalCommandNotifier({ ...disabled, isEnabled: () => false })(
      { terminalId: "t1", terminalName: "zsh", command: command(), isTerminalVisible: false },
      vi.fn(),
    );
    expect(disabled.showToast).not.toHaveBeenCalled();

    const denied = createDependencies({ permission: false });
    await createTerminalCommandNotifier(denied)(
      { terminalId: "t1", terminalName: "zsh", command: command(), isTerminalVisible: false },
      vi.fn(),
    );
    expect(denied.showToast).toHaveBeenCalledTimes(1);
    expect(denied.sendNative).not.toHaveBeenCalled();
  });
});
