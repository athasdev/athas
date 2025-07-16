import type { ContextItem, FileEntry } from "../types";

export class RulesProvider {
  private allFiles: FileEntry[] = [];
  private configFiles: ContextItem[] = [];

  setFiles(files: FileEntry[]) {
    this.allFiles = files;
    this.updateConfigFiles();
  }

  private updateConfigFiles() {
    this.configFiles = this.allFiles
      .filter(file => !file.isDir && this.isConfigFile(file))
      .map(file => ({
        id: file.path,
        name: file.name,
        description: this.getConfigDescription(file.name),
        path: file.path,
        type: "config",
        metadata: { fileEntry: file },
      }));
  }

  private isConfigFile(file: FileEntry): boolean {
    const fileName = file.name.toLowerCase();
    const configPatterns = [
      // ESLint
      ".eslintrc",
      "eslint.config",
      // Prettier
      ".prettierrc",
      "prettier.config",
      // TypeScript
      "tsconfig.json",
      "jsconfig.json",
      // Bundlers
      "webpack.config",
      "vite.config",
      "rollup.config",
      // Package managers
      "package.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      // Git
      ".gitignore",
      ".gitattributes",
      // Editor
      ".editorconfig",
      // CI/CD
      ".github/",
      "dockerfile",
      "docker-compose",
      // Testing
      "jest.config",
      "vitest.config",
      "playwright.config",
      // Other configs
      ".env",
      "tailwind.config",
      "postcss.config",
    ];

    return configPatterns.some(
      pattern =>
        fileName.includes(pattern.toLowerCase()) || file.path.toLowerCase().includes(pattern),
    );
  }

  private getConfigDescription(fileName: string): string {
    const name = fileName.toLowerCase();

    if (name.includes("eslint")) return "ESLint configuration";
    if (name.includes("prettier")) return "Prettier configuration";
    if (name.includes("tsconfig")) return "TypeScript configuration";
    if (name.includes("webpack")) return "Webpack configuration";
    if (name.includes("vite")) return "Vite configuration";
    if (name.includes("package.json")) return "Package configuration";
    if (name.includes("gitignore")) return "Git ignore rules";
    if (name.includes("dockerfile")) return "Docker configuration";
    if (name.includes("jest")) return "Jest testing configuration";
    if (name.includes("tailwind")) return "Tailwind CSS configuration";
    if (name.includes(".env")) return "Environment variables";

    return "Configuration file";
  }

  search(query: string): ContextItem[] {
    if (!query.trim()) {
      return this.configFiles.slice(0, 20);
    }

    const lowerQuery = query.toLowerCase();
    const scored = this.configFiles
      .map(file => ({
        file,
        score: this.calculateScore(
          `${file.name.toLowerCase()} ${file.description?.toLowerCase()}`,
          lowerQuery,
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 20).map(({ file }) => file);
  }

  private calculateScore(text: string, query: string): number {
    if (text === query) return 1000;
    if (text.startsWith(query)) return 800;
    if (text.includes(query)) return 600;

    // Fuzzy matching
    let score = 0;
    let queryIndex = 0;

    for (let i = 0; i < text.length && queryIndex < query.length; i++) {
      if (text[i] === query[queryIndex]) {
        score += 10;
        queryIndex++;
      }
    }

    return queryIndex === query.length ? score : 0;
  }

  getAll(): ContextItem[] {
    return this.configFiles.slice(0, 20);
  }
}
