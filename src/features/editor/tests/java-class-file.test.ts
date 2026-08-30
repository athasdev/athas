import { describe, expect, it } from "vite-plus/test";
import { getJavaClassFileName, isJavaClassFileUri } from "../lsp/java-class-file";

describe("Java class file URIs", () => {
  it("recognizes JDT class file locations", () => {
    expect(isJavaClassFileUri("jdt://contents/java.base/java.lang/String.class?source")).toBe(true);
    expect(isJavaClassFileUri("file:///repo/String.java")).toBe(false);
  });

  it("uses the decoded class name for virtual buffers", () => {
    expect(
      getJavaClassFileName("jdt://contents/java.base/java.util/Map%24Entry.class?source"),
    ).toBe("Map$Entry.class");
  });
});
