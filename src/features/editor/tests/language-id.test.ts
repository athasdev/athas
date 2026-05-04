import { describe, expect, it } from "vite-plus/test";
import { getLanguageDisplayName, getLanguageIdFromPath } from "../utils/language-id";

describe("getLanguageIdFromPath", () => {
  it("detects scm files as scheme", () => {
    expect(getLanguageIdFromPath("/tmp/highlights.scm")).toBe("scheme");
  });

  it("detects nix files", () => {
    expect(getLanguageIdFromPath("/tmp/flake.nix")).toBe("nix");
  });

  it("detects Angular component templates", () => {
    expect(getLanguageIdFromPath("/tmp/src/app/app.component.html")).toBe("angular");
    expect(getLanguageIdFromPath("/tmp/src/app/app.ng.html")).toBe("angular");
  });

  it("keeps regular html files as html", () => {
    expect(getLanguageIdFromPath("/tmp/index.html")).toBe("html");
  });

  it("detects dotenv files", () => {
    expect(getLanguageIdFromPath("/tmp/.env")).toBe("dotenv");
    expect(getLanguageIdFromPath("/tmp/.env.local")).toBe("dotenv");
    expect(getLanguageIdFromPath("/tmp/.env.production.local")).toBe("dotenv");
    expect(getLanguageDisplayName("dotenv")).toBe("Dotenv");
  });
});
