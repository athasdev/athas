import { describe, expect, it } from "vite-plus/test";
import { shouldHideFromFileTree } from "../controllers/utils";

describe("file tree ignore rules", () => {
  it("keeps project files visible in the file tree", () => {
    expect(shouldHideFromFileTree("bun.lock")).toBe(false);
    expect(shouldHideFromFileTree("Cargo.lock")).toBe(false);
    expect(shouldHideFromFileTree("node_modules")).toBe(false);
    expect(shouldHideFromFileTree(".env")).toBe(false);
  });

  it("hides generated OS metadata files", () => {
    expect(shouldHideFromFileTree(".DS_Store")).toBe(true);
    expect(shouldHideFromFileTree("._README.md")).toBe(true);
    expect(shouldHideFromFileTree("Thumbs.db")).toBe(true);
  });
});
