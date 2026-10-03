import { describe, expect, it } from "vite-plus/test";
import { formatDroppedPathsForTerminal, getTerminalQuoteStyle } from "../utils/terminal-file-drop";

describe("formatDroppedPathsForTerminal", () => {
  it("formats dropped paths for insertion into a shell prompt", () => {
    expect(
      formatDroppedPathsForTerminal([
        "file:///Users/test/My%20Image.png",
        "/Users/test/project/file.ts",
      ]),
    ).toBe("'/Users/test/My Image.png' /Users/test/project/file.ts ");
  });

  it("drops unsupported payload entries", () => {
    expect(formatDroppedPathsForTerminal(["https://athas.dev", "relative/path.ts"])).toBe("");
  });

  it("neutralizes newlines and shell metacharacters in file names", () => {
    expect(formatDroppedPathsForTerminal(['/tmp/x"\n/tmp/evil|sh\n'])).toBe(
      `'/tmp/x"' '/tmp/evil|sh' `,
    );
    expect(formatDroppedPathsForTerminal(["/tmp/$(touch pwned)"])).toBe("'/tmp/$(touch pwned)' ");
    expect(formatDroppedPathsForTerminal(["/tmp/it's here"])).toBe(`'/tmp/it'\\''s here' `);
  });

  it("uses double quotes for cmd", () => {
    expect(
      formatDroppedPathsForTerminal(["C:\\Users\\me\\My Files\\a&b.txt", "C:\\plain.txt"], "cmd"),
    ).toBe('"C:\\Users\\me\\My Files\\a&b.txt" C:\\plain.txt ');
  });

  it("uses literal single quotes for PowerShell", () => {
    expect(formatDroppedPathsForTerminal(["C:\\Users\\me\\it's $(calc).txt"], "powershell")).toBe(
      "'C:\\Users\\me\\it''s $(calc).txt' ",
    );
    expect(formatDroppedPathsForTerminal(["C:\\a\u2019b.txt"], "powershell")).toBe(
      "'C:\\a\u2019\u2019b.txt' ",
    );
  });
});

describe("getTerminalQuoteStyle", () => {
  it("uses POSIX quoting outside Windows and for remote terminals", () => {
    expect(getTerminalQuoteStyle("zsh", "macos")).toBe("posix");
    expect(getTerminalQuoteStyle(undefined, "linux")).toBe("posix");
    expect(getTerminalQuoteStyle("cmd", "windows", true)).toBe("posix");
  });

  it("follows the selected Windows shell", () => {
    expect(getTerminalQuoteStyle(undefined, "windows")).toBe("cmd");
    expect(getTerminalQuoteStyle("cmd", "windows")).toBe("cmd");
    expect(getTerminalQuoteStyle("pwsh", "windows")).toBe("powershell");
    expect(getTerminalQuoteStyle("PowerShell", "windows")).toBe("powershell");
    expect(getTerminalQuoteStyle("bash", "windows")).toBe("posix");
    expect(getTerminalQuoteStyle("wsl:Ubuntu", "windows")).toBe("posix");
  });
});
