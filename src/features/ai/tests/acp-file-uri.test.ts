import { describe, expect, it } from "vite-plus/test";
import { getAcpPathBaseName, toAcpFileUri } from "@/features/ai/lib/acp-file-uri";

describe("ACP file URI", () => {
  it("builds POSIX file URIs", () => {
    expect(toAcpFileUri("/Users/me/project/src/app.ts")).toBe(
      "file:///Users/me/project/src/app.ts",
    );
  });

  it("builds Windows drive file URIs", () => {
    expect(toAcpFileUri("C:\\Users\\me\\Project Folder\\app.ts")).toBe(
      "file:///C:/Users/me/Project%20Folder/app.ts",
    );
  });

  it("builds UNC file URIs", () => {
    expect(toAcpFileUri("\\\\server\\share\\Project Folder\\app.ts")).toBe(
      "file://server/share/Project%20Folder/app.ts",
    );
  });

  it("extracts names from Windows and POSIX paths", () => {
    expect(getAcpPathBaseName("C:\\Users\\me\\app.ts")).toBe("app.ts");
    expect(getAcpPathBaseName("/Users/me/app.ts")).toBe("app.ts");
  });
});
