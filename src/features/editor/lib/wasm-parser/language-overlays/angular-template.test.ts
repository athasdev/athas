import { describe, expect, it } from "vite-plus/test";
import { angularTemplateTokens, isAngularTemplatePath } from "./angular-template";

describe("angular template support", () => {
  it("detects Angular template file names", () => {
    expect(isAngularTemplatePath("/tmp/app.component.html")).toBe(true);
    expect(isAngularTemplatePath("/tmp/app.ng.html")).toBe(true);
    expect(isAngularTemplatePath("/tmp/index.html")).toBe(false);
  });

  it("adds tokens for common Angular template syntax", () => {
    const content = `<button *ngIf="isReady" [disabled]="busy" (click)="save()">{{ value | async }}</button>\n@if (isReady) { ok }`;
    const tokens = angularTemplateTokens(content);
    const textByType = tokens.map((token) => ({
      type: token.type,
      text: content.slice(token.startIndex, token.endIndex),
    }));

    expect(textByType).toContainEqual({ type: "token-keyword", text: "*ngIf" });
    expect(textByType).toContainEqual({ type: "token-property", text: "disabled" });
    expect(textByType).toContainEqual({ type: "token-function", text: "click" });
    expect(textByType).toContainEqual({ type: "token-function", text: "async" });
    expect(textByType).toContainEqual({ type: "token-keyword", text: "@if" });
  });
});
