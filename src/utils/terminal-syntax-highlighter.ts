import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";

interface HighlightResult {
  content: string;
  language: string | null;
  isHighlighted: boolean;
}

export class TerminalSyntaxHighlighter {
  private static instance: TerminalSyntaxHighlighter;

  private constructor() {}

  public static getInstance(): TerminalSyntaxHighlighter {
    if (!TerminalSyntaxHighlighter.instance) {
      TerminalSyntaxHighlighter.instance = new TerminalSyntaxHighlighter();
    }
    return TerminalSyntaxHighlighter.instance;
  }

  private detectLanguage(content: string): string | null {
    const trimmed = content.trim();

    // JSON detection
    if (this.isJSON(trimmed)) {
      return "json";
    }

    // Git diff detection
    if (this.isGitDiff(trimmed)) {
      return "diff";
    }

    // Package.json, tsconfig.json, etc.
    if (this.isPackageJson(trimmed)) {
      return "json";
    }

    // YAML detection
    if (this.isYAML(trimmed)) {
      return "yaml";
    }

    // Code file extensions in ls output
    if (this.containsCodeFiles(trimmed)) {
      return "bash";
    }

    // Error messages and stack traces
    if (this.isErrorOutput(trimmed)) {
      return "bash";
    }

    // Common command outputs
    if (this.isCommandOutput(trimmed)) {
      return "bash";
    }

    return null;
  }

  private isJSON(content: string): boolean {
    try {
      JSON.parse(content);
      return content.startsWith("{") || content.startsWith("[");
    } catch {
      return false;
    }
  }

  private isGitDiff(content: string): boolean {
    return (
      content.includes("diff --git") ||
      content.includes("@@") ||
      content.match(/^\+\+\+|---/m) !== null
    );
  }

  private isPackageJson(content: string): boolean {
    return (
      content.includes('"name"') &&
      content.includes('"version"') &&
      (content.includes('"dependencies"') || content.includes('"scripts"'))
    );
  }

  private isYAML(content: string): boolean {
    return (
      content.includes("---") ||
      content.match(/^\w+:\s*$/m) !== null ||
      content.match(/^\s*-\s+\w+/m) !== null
    );
  }

  private containsCodeFiles(content: string): boolean {
    const codeExtensions = [
      ".js",
      ".ts",
      ".tsx",
      ".jsx",
      ".py",
      ".rs",
      ".go",
      ".java",
      ".c",
      ".cpp",
      ".h",
    ];
    return codeExtensions.some(ext => content.includes(ext));
  }

  private isErrorOutput(content: string): boolean {
    const errorPatterns = [
      "Error:",
      "TypeError:",
      "SyntaxError:",
      "ReferenceError:",
      "fatal:",
      "error:",
      "WARNING:",
      "WARN:",
      "Exception",
      "Traceback",
      "at Object.",
      "at Function.",
      "stack trace",
      "segfault",
      "panic:",
    ];

    return errorPatterns.some(pattern => content.includes(pattern));
  }

  private isCommandOutput(content: string): boolean {
    const commandPatterns = [
      // ls output patterns
      /^(total \d+|\w+\s+\w+\s+\w+\s+\w+\s+\d+)/m,
      // git status patterns
      /^(On branch|Changes not staged|Changes to be committed|Untracked files)/m,
      // npm/bun patterns
      /^(npm|bun|yarn)\s+(install|run|build|test)/m,
      // File permissions
      /^[drwx-]{10}\s+\d+/m,
      // Process lists
      /^\s*PID\s+/m,
      // Network connections
      /^\s*Proto\s+/m,
      // Docker patterns
      /^(CONTAINER ID|IMAGE|COMMAND|CREATED|STATUS|PORTS|NAMES)/m,
      // Kubernetes patterns
      /^(NAME\s+READY|NAMESPACE|kubectl)/m,
      // Cargo patterns
      /^(Compiling|Finished|Running|Building|Created)/m,
      // Test output patterns
      /^(test |running \d+ tests|failures:|test result:)/m,
      // Build tool patterns
      /^(webpack|vite|tsc|rustc|go build)/m,
      // Package manager outputs
      /^(added \d+|removed \d+|up to date|audit|found \d+)/m,
    ];

    return commandPatterns.some(pattern => pattern.test(content));
  }

  private addCustomStyling(highlightedContent: string, language: string): string {
    let styled = highlightedContent;

    // Add custom styling for terminal-specific elements
    if (language === "bash") {
      // Highlight file paths
      styled = styled.replace(/\/[\w\-._/]+/g, '<span class="text-blue-400">$&</span>');

      // Highlight URLs
      styled = styled.replace(
        /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=]+/g,
        '<span class="text-blue-400 underline">$&</span>',
      );

      // Highlight file extensions with specific colors
      styled = styled.replace(/\w+\.(js|jsx|ts|tsx)/g, '<span class="terminal-file-js">$&</span>');

      styled = styled.replace(/\w+\.py/g, '<span class="terminal-file-py">$&</span>');

      styled = styled.replace(/\w+\.rs/g, '<span class="terminal-file-rs">$&</span>');

      styled = styled.replace(/\w+\.go/g, '<span class="terminal-file-go">$&</span>');

      styled = styled.replace(/\w+\.json/g, '<span class="terminal-file-json">$&</span>');

      // Highlight git status indicators
      styled = styled.replace(
        /^(\s*)(modified:|new file:|deleted:|renamed:|copied:)/gm,
        '$1<span class="text-yellow-400">$2</span>',
      );

      // Highlight git diff markers
      styled = styled.replace(/^(\+\+\+|---)/gm, '<span class="text-cyan-400">$1</span>');

      // Highlight npm/bun commands
      styled = styled.replace(
        /^(npm|bun|yarn)\s+(install|run|build|test|start|dev)/gm,
        '<span class="text-purple-400">$1</span> <span class="text-green-400">$2</span>',
      );

      // Highlight cargo commands
      styled = styled.replace(
        /^(Compiling|Finished|Running|Building|Created)/gm,
        '<span class="text-orange-400">$1</span>',
      );

      // Highlight test results
      styled = styled.replace(
        /(test result:|running \d+ tests|failures:)/g,
        '<span class="text-cyan-400">$1</span>',
      );

      styled = styled.replace(/(\d+) passed/g, '<span class="text-green-400">$1 passed</span>');

      styled = styled.replace(/(\d+) failed/g, '<span class="text-red-400">$1 failed</span>');

      // Highlight errors in red
      styled = styled.replace(
        /(error|Error|ERROR|failed|Failed|FAILED|fatal|Fatal|FATAL)/g,
        '<span class="text-red-400 font-bold">$1</span>',
      );

      // Highlight warnings in yellow
      styled = styled.replace(
        /(warning|Warning|WARNING|warn|Warn|WARN)/g,
        '<span class="text-yellow-400 font-bold">$1</span>',
      );

      // Highlight success messages in green
      styled = styled.replace(
        /(success|Success|SUCCESS|done|Done|DONE|completed|Completed|COMPLETED)/g,
        '<span class="text-green-400 font-bold">$1</span>',
      );

      // Highlight version numbers
      styled = styled.replace(/v?\d+\.\d+\.\d+/g, '<span class="text-blue-300">$&</span>');

      // Highlight docker/container IDs
      styled = styled.replace(/\b[a-f0-9]{12,64}\b/g, '<span class="text-gray-400">$&</span>');
    }

    return styled;
  }

  public highlight(content: string): HighlightResult {
    if (!content || content.trim().length === 0) {
      return {
        content,
        language: null,
        isHighlighted: false,
      };
    }

    const language = this.detectLanguage(content);

    if (!language) {
      return {
        content,
        language: null,
        isHighlighted: false,
      };
    }

    try {
      const highlightedContent = Prism.highlight(content, Prism.languages[language], language);
      const styledContent = this.addCustomStyling(highlightedContent, language);

      return {
        content: styledContent,
        language,
        isHighlighted: true,
      };
    } catch (error) {
      console.warn("Syntax highlighting failed:", error);
      return {
        content,
        language: null,
        isHighlighted: false,
      };
    }
  }

  public highlightLine(line: string): HighlightResult {
    return this.highlight(line);
  }
}

export const terminalSyntaxHighlighter = TerminalSyntaxHighlighter.getInstance();
