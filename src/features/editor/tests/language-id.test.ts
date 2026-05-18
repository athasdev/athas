import { describe, expect, it } from "vite-plus/test";
import { getLanguageDisplayName, getLanguageIdFromPath } from "../utils/language-id";
import {
  MONACO_HIGHLIGHT_LANGUAGE_IDS,
  MONACO_LANGUAGE_BY_ATHAS_ID,
  toMonacoLanguageId,
} from "../monaco/language";

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

  it("detects extension-backed highlight languages without registry data", () => {
    expect(getLanguageIdFromPath("/tmp/styles.scss")).toBe("scss");
    expect(getLanguageIdFromPath("/tmp/Dockerfile")).toBe("dockerfile");
    expect(getLanguageIdFromPath("/tmp/example.diff")).toBe("diff");
    expect(getLanguageIdFromPath("/tmp/example.patch")).toBe("diff");
    expect(getLanguageIdFromPath("/tmp/schema.graphql")).toBe("graphql");
    expect(getLanguageIdFromPath("/tmp/message.proto")).toBe("protobuf");
    expect(getLanguageIdFromPath("/tmp/query.ql")).toBe("ql");
    expect(getLanguageIdFromPath("/tmp/main.tf")).toBe("terraform");
    expect(getLanguageIdFromPath("/tmp/icon.svg")).toBe("xml");
    expect(getLanguageIdFromPath("/tmp/project.csproj")).toBe("xml");
    expect(getLanguageDisplayName("diff")).toBe("Diff");
  });
});

describe("toMonacoLanguageId", () => {
  it("maps every Monaco-backed Athas language to a bundled highlight contribution", () => {
    for (const [athasLanguageId, monacoLanguageId] of Object.entries(MONACO_LANGUAGE_BY_ATHAS_ID)) {
      if (monacoLanguageId === "plaintext") continue;

      expect(
        MONACO_HIGHLIGHT_LANGUAGE_IDS.has(toMonacoLanguageId(athasLanguageId)),
        `${athasLanguageId} maps to ${monacoLanguageId}`,
      ).toBe(true);
    }
  });
});
