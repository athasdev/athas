import { describe, expect, it } from "vite-plus/test";
import { isAngularTemplatePath } from "../utils/angular-template";

describe("angular template support", () => {
  it("detects Angular template file names", () => {
    expect(isAngularTemplatePath("/tmp/app.component.html")).toBe(true);
    expect(isAngularTemplatePath("/tmp/app.ng.html")).toBe(true);
    expect(isAngularTemplatePath("/tmp/index.html")).toBe(false);
  });
});
