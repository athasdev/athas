import { describe, expect, test, vi } from "vite-plus/test";
import type { DebugLaunchConfig } from "../types/debugger.types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  buildDebugAdapterRequestArguments,
  getExceptionBreakpointFilters,
  sendDebugAdapterResponse,
} from "../services/debug-adapter-service";

describe("debug adapter service", () => {
  test("passes Java launch options through without leaking Athas adapter fields", () => {
    const config: DebugLaunchConfig = {
      id: "java",
      name: "Launch Java",
      runtime: "java",
      type: "java",
      request: "launch",
      adapterCommand: "java-debug-adapter",
      adapterArgs: ["--stdio"],
      adapterConfiguration: {
        name: "Launch Java",
        type: "java",
        request: "launch",
        mainClass: "com.example.Main",
        projectName: "demo",
        vmArgs: "-Xmx1g",
        args: "--profile debug",
        stepFilters: { skipClasses: ["$JDK"] },
      },
      source: "workspace",
    };

    expect(buildDebugAdapterRequestArguments(config)).toEqual({
      name: "Launch Java",
      type: "java",
      request: "launch",
      mainClass: "com.example.Main",
      projectName: "demo",
      vmArgs: "-Xmx1g",
      args: "--profile debug",
      stepFilters: { skipClasses: ["$JDK"] },
    });
  });

  test("responds to reverse debug adapter requests through the active session", async () => {
    await sendDebugAdapterResponse("session-1", 42, "runInTerminal", true, {});

    expect(invoke).toHaveBeenCalledWith("debug_send_raw_message", {
      sessionId: "session-1",
      message: {
        type: "response",
        request_seq: 42,
        command: "runInTerminal",
        success: true,
        body: {},
      },
    });
  });

  test("normalizes adapter-provided exception breakpoint filters", () => {
    expect(
      getExceptionBreakpointFilters({
        exceptionBreakpointFilters: [
          {
            filter: "uncaught",
            label: "Uncaught Exceptions",
            description: "Break when an exception is not handled.",
            default: true,
          },
          { filter: 123, label: "Invalid" },
        ],
      }),
    ).toEqual([
      {
        filter: "uncaught",
        label: "Uncaught Exceptions",
        description: "Break when an exception is not handled.",
        default: true,
        supportsCondition: false,
        conditionDescription: undefined,
      },
    ]);
  });
});
