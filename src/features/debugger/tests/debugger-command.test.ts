import { describe, expect, test } from "vite-plus/test";
import {
  buildDebugCommand,
  createGeneratedDebugConfig,
  inferDebuggerRuntime,
  normalizeLaunchConfigs,
  parseDebugLaunchJson,
  resolveDebugConfigVariables,
} from "../utils/debugger-command";

describe("debugger command helpers", () => {
  test("infers common runtimes from file extensions", () => {
    expect(inferDebuggerRuntime({ path: "/repo/app.ts", name: "app.ts" })).toBe("bun");
    expect(inferDebuggerRuntime({ path: "/repo/app.py", name: "app.py" })).toBe("python");
    expect(inferDebuggerRuntime({ path: "/repo/main.go", name: "main.go" })).toBe("go");
    expect(inferDebuggerRuntime({ path: "/repo/src/main.rs", name: "main.rs" })).toBe("rust");
  });

  test("builds a bun inspector command for generated typescript configs", () => {
    const config = createGeneratedDebugConfig(
      { path: "/repo/src/main.ts", name: "main.ts" },
      "/repo",
    );

    expect(buildDebugCommand(config)).toBe("bun --inspect-brk /repo/src/main.ts");
  });

  test("normalizes launch.json style configs", () => {
    const configs = normalizeLaunchConfigs({
      configurations: [
        {
          name: "Launch API",
          type: "node",
          program: "/repo/server.js",
          args: ["--port", "3000"],
          adapterCommand: "node",
          adapterArgs: ["/repo/js-debug/dap.js"],
        },
      ],
    });

    expect(configs).toHaveLength(1);
    expect(configs[0]?.runtime).toBe("node");
    expect(configs[0]?.adapterCommand).toBe("node");
    expect(configs[0]?.adapterArgs).toEqual(["/repo/js-debug/dap.js"]);
    expect(buildDebugCommand(configs[0]!)).toBe("node --inspect-brk /repo/server.js --port 3000");
  });

  test("parses jsonc launch configs", () => {
    const configs = parseDebugLaunchJson(`{
      // local launch
      "configurations": [
        { "name": "Python", "type": "python", "program": "/repo/app.py" }
      ]
    }`);

    expect(configs[0]?.runtime).toBe("python");
  });

  test("resolves common launch variables", () => {
    const [config] = normalizeLaunchConfigs({
      configurations: [
        {
          name: "Launch file",
          type: "node",
          cwd: "${workspaceFolder}",
          program: "${file}",
          args: ["${fileBasename}"],
        },
      ],
    });

    const resolved = resolveDebugConfigVariables(
      config!,
      { path: "/repo/src/app.js", name: "app.js" },
      "/repo",
    );

    expect(resolved.cwd).toBe("/repo");
    expect(resolved.program).toBe("/repo/src/app.js");
    expect(resolved.args).toEqual(["app.js"]);
  });
});
