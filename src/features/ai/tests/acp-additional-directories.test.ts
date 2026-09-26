import { describe, expect, it } from "vite-plus/test";
import { getAcpAdditionalDirectories } from "@/features/ai/lib/acp-additional-directories";

describe("getAcpAdditionalDirectories", () => {
  it("lists the other local workspace roots once", () => {
    expect(
      getAcpAdditionalDirectories("/work/app", [
        { path: "/work/app" },
        { path: "/work/docs/" },
        { path: "remote://host/srv" },
        { path: "/work/lib" },
        { path: "/work/docs" },
      ]),
    ).toEqual(["/work/docs", "/work/lib"]);
  });

  it("sends nothing for a single-root workspace", () => {
    expect(getAcpAdditionalDirectories("/work/app", [{ path: "/work/app" }])).toEqual([]);
    expect(getAcpAdditionalDirectories(null, [])).toEqual([]);
  });
});
