import { describe, expect, it } from "vite-plus/test";
import {
  getCommandAllowPrefix,
  isBuiltInSafeCommand,
  matchesAllowedPrefix,
} from "../intelligence/lib/intelligence-command-policy";
import { toIntelligenceAgentError } from "../intelligence/lib/intelligence-agent-error";

describe("Intelligence command policy", () => {
  it.each([
    "git status",
    "git diff --stat",
    "ls -la src",
    "rg needle src",
    "git branch -a",
    "wc -l a.ts",
  ])("runs read-only %s without asking", (command) =>
    expect(isBuiltInSafeCommand(command)).toBe(true),
  );

  it.each([
    "git status; rm -rf .",
    "cat src/a.ts | sh",
    "ls > out.txt",
    "echo $(whoami)",
    "cat ~/.ssh/id_rsa",
    "cat /etc/passwd",
    "cat ../other/secret",
    "cat .env",
    "git diff --output=patch.txt",
    "git branch -D main",
    "git push",
    "find . -delete",
    "FOO=1 ls",
    "/tmp/ls",
  ])("asks before %s", (command) => expect(isBuiltInSafeCommand(command)).toBe(false));

  it("remembers a program and its subcommand, never a destructive command", () => {
    expect(getCommandAllowPrefix("bun test src/a.test.ts")).toBe("bun test");
    expect(getCommandAllowPrefix("cargo check --workspace")).toBe("cargo check");
    expect(getCommandAllowPrefix("make")).toBe("make");
    expect(getCommandAllowPrefix("python script.py")).toBe("python");
    for (const command of [
      "rm -rf dist",
      "sudo bun test",
      "git push origin",
      "git reset --hard",
      "bun test && rm x",
    ])
      expect(getCommandAllowPrefix(command)).toBeNull();
  });

  it("matches remembered prefixes word by word and only for simple workspace commands", () => {
    expect(matchesAllowedPrefix("bun test src", ["bun test"])).toBe(true);
    expect(matchesAllowedPrefix("bun testing", ["bun test"])).toBe(false);
    expect(matchesAllowedPrefix("bun test; rm -rf .", ["bun test"])).toBe(false);
    expect(matchesAllowedPrefix("bun test /etc", ["bun test"])).toBe(false);
    expect(matchesAllowedPrefix("rm -rf dist", ["rm"])).toBe(false);
  });
});

describe("Intelligence agent errors", () => {
  it("turns a raw error payload into an error with a status the chat can map", () => {
    const error = toIntelligenceAgentError({ error: { message: "Slow down.", code: "http_429" } });
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "Slow down.", code: "http_429", statusCode: 429 });
    expect(String(toIntelligenceAgentError({}))).not.toContain("[object Object]");
  });
});
