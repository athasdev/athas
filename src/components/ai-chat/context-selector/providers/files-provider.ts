import type { ContextItem, FileEntry } from "../types";

export class FilesProvider {
  private allFiles: FileEntry[] = [];
  private filteredFiles: ContextItem[] = [];

  setFiles(files: FileEntry[]) {
    this.allFiles = files;
    this.updateFilteredFiles();
  }

  private updateFilteredFiles() {
    this.filteredFiles = this.allFiles
      .filter(file => !file.isDir && !this.isIgnoredFile(file.path))
      .map(file => ({
        id: file.path,
        name: file.name,
        description: this.getRelativePath(file.path),
        path: file.path,
        type: "file",
        metadata: { fileEntry: file },
      }));
  }

  private isIgnoredFile(path: string): boolean {
    const ignoredPatterns = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      ".cache",
      ".DS_Store",
      "*.log",
      "coverage",
      ".nyc_output",
    ];

    return ignoredPatterns.some(pattern => {
      if (pattern.includes("*")) {
        const regex = new RegExp(pattern.replace(/\*/g, ".*"));
        return regex.test(path);
      }
      return path.includes(pattern);
    });
  }

  private getRelativePath(fullPath: string): string {
    // Simple relative path extraction - can be enhanced later
    const parts = fullPath.split("/");
    return parts.slice(0, -1).join("/");
  }

  search(query: string): ContextItem[] {
    if (!query.trim()) {
      return this.filteredFiles.slice(0, 20);
    }

    const lowerQuery = query.toLowerCase();
    const scored = this.filteredFiles
      .map(file => ({
        file,
        score: this.calculateScore(file.name.toLowerCase(), lowerQuery),
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
    return this.filteredFiles.slice(0, 20);
  }
}
