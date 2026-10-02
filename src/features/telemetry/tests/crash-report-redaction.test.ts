import { describe, expect, it } from "vite-plus/test";
import { redactCrashText } from "../lib/crash-report-redaction";

describe("Crash report redaction", () => {
  it("removes quoted content that can echo prompts, model output or file text", () => {
    expect(
      redactCrashText(`SyntaxError: Unexpected token 'c', "const apiKey = 1" is not valid JSON`),
    ).toBe("SyntaxError: Unexpected token <redacted>, <redacted> is not valid JSON");
  });

  it("removes paths in the user's folders but keeps app frames", () => {
    expect(
      redactCrashText(
        "Error: ENOENT /Users/ada/secret-project/src/main.ts\n    at run (tauri://localhost/assets/index.js:10:5)",
      ),
    ).toBe("Error: ENOENT <path>\n    at run (tauri://localhost/assets/index.js:10:5)");
    expect(redactCrashText("failed to read C:\\Users\\ada\\notes.txt")).toBe(
      "failed to read <path>",
    );
  });

  it("drops values that are not text", () => {
    expect(redactCrashText(undefined)).toBeNull();
    expect(redactCrashText(42)).toBeNull();
  });
});
