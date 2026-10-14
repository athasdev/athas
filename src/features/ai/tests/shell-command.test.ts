import { describe, expect, it } from "vite-plus/test";
import {
  cleanCommand,
  isLongRunningCommand,
  shortenCommand,
  unwrapShellCommand,
} from "../lib/shell-command";

describe("shell command unwrapping", () => {
  it("unwraps POSIX shells run with -c or -lc", () => {
    expect(unwrapShellCommand("/bin/zsh -lc 'bun dev'")).toBe("bun dev");
    expect(unwrapShellCommand('bash -c "npm test -- --watch=false"')).toBe(
      "npm test -- --watch=false",
    );
    expect(unwrapShellCommand("sh -c ls")).toBe("ls");
    expect(unwrapShellCommand("/usr/bin/env bash")).toBe("/usr/bin/env bash");
    expect(unwrapShellCommand("bash script.sh")).toBe("bash script.sh");
  });

  it("unwraps cmd and PowerShell", () => {
    expect(unwrapShellCommand("cmd.exe /c npm run build")).toBe("npm run build");
    expect(unwrapShellCommand('powershell -NoProfile -Command "bun dev"')).toBe("bun dev");
    expect(unwrapShellCommand("pwsh -c npm test")).toBe("npm test");
  });

  it("unwraps command arrays and nested wrappers, keeping the command exact", () => {
    expect(unwrapShellCommand(["/bin/zsh", "-lc", "cd /work/app && bun dev"])).toBe(
      "cd /work/app && bun dev",
    );
    expect(unwrapShellCommand(["git", "status"])).toBe("git status");
    expect(unwrapShellCommand(`bash -lc "zsh -c 'pnpm dev'"`)).toBe("pnpm dev");
  });
});

describe("command labels", () => {
  it("drops version managers, runners and launchers", () => {
    expect(
      cleanCommand("/bin/zsh -lc 'mise exec node@24.19.0 -- ./node_modules/.bin/vp run dev'"),
    ).toBe("vp run dev");
    expect(cleanCommand("mise x node@22 -- npm test")).toBe("npm test");
    expect(cleanCommand("asdf exec node server.js")).toBe("node server.js");
    expect(cleanCommand("nvm exec 20 node server.js")).toBe("node server.js");
    expect(cleanCommand("volta run --node 20 npm start")).toBe("npm start");
    expect(cleanCommand("fnm exec --using=22 -- bun dev")).toBe("bun dev");
    expect(cleanCommand("npx -y vite --port 3000")).toBe("vite --port 3000");
    expect(cleanCommand("pnpm dlx serve dist")).toBe("serve dist");
    expect(cleanCommand("env PORT=3000 NODE_ENV=dev nice -n 10 nohup time bun dev")).toBe(
      "bun dev",
    );
    expect(
      cleanCommand(["/bin/bash", "-lc", "cd '/work/my app' && /usr/local/bin/node app.js"]),
    ).toBe("node app.js");
  });

  it("shortens a command to what it runs", () => {
    expect(shortenCommand("/bin/zsh -lc 'bun dev --port 5173'")).toBe("bun dev");
    expect(shortenCommand("npm test -- --runInBand")).toBe("npm test");
    expect(shortenCommand("NODE_ENV=test /usr/local/bin/node server.js | tee out.log")).toBe(
      "node server.js",
    );
    expect(shortenCommand("bunx vp test run src/features")).toBe("vp test run");
  });

  it("recognises dev servers and watchers", () => {
    expect(isLongRunningCommand("mise exec node@24 -- ./node_modules/.bin/vp run dev")).toBe(true);
    expect(isLongRunningCommand("npm run dev:web")).toBe(true);
    expect(isLongRunningCommand("npx vite")).toBe(true);
    expect(isLongRunningCommand("tsc --watch")).toBe(true);
    expect(isLongRunningCommand("bun test")).toBe(false);
    expect(isLongRunningCommand("git status")).toBe(false);
  });
});
