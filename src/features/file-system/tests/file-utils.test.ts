import { describe, expect, it } from "vite-plus/test";
import { isBinaryContent, isKnownTextFile } from "../controllers/file-utils";

describe("file utils", () => {
  it("treats recognized editor languages as text files", () => {
    expect(isKnownTextFile("/project/scenes/scene.lua")).toBe(true);
    expect(isKnownTextFile("/project/components/App.vue")).toBe(true);
    expect(isKnownTextFile("/project/flake.nix")).toBe(true);
  });

  it("keeps Lua source out of binary detection even when bytes look suspicious", () => {
    const luaSourceWithNullByte = new Uint8Array([
      ...new TextEncoder().encode('-- scene.lua\nlocal title = "清秋"\n'),
      0,
      ...new TextEncoder().encode("\nreturn title\n"),
    ]);

    expect(isBinaryContent(luaSourceWithNullByte)).toBe(true);
    expect(isKnownTextFile("/project/scene.lua")).toBe(true);
  });
});
