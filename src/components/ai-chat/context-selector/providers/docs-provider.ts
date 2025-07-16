import type { ContextItem, FileEntry } from "../types";

export class DocsProvider {
  private allFiles: FileEntry[] = [];
  private docFiles: ContextItem[] = [];

  setFiles(files: FileEntry[]) {
    this.allFiles = files;
    this.updateDocFiles();
  }

  private updateDocFiles() {
    this.docFiles = this.allFiles
      .filter(file => !file.isDir && this.isDocFile(file))
      .map(file => ({
        id: file.path,
        name: file.name,
        description: this.getRelativePath(file.path),
        path: file.path,
        type: "doc",
        metadata: { fileEntry: file },
      }));
  }

  private isDocFile(file: FileEntry): boolean {
    const fileName = file.name.toLowerCase();
    const filePath = file.path.toLowerCase();

    // Check by extension
    const hasDocExtension = [".md", ".txt", ".rst"].some(ext => fileName.endsWith(ext));

    // Check by common doc file names
    const isCommonDoc = ["readme", "changelog", "license", "contributing"].some(name =>
      fileName.includes(name),
    );

    // Check by path patterns
    const isInDocsFolder = ["docs/", "documentation/", "guide/"].some(pattern =>
      filePath.includes(pattern),
    );

    return hasDocExtension || isCommonDoc || isInDocsFolder;
  }

  private getRelativePath(fullPath: string): string {
    const parts = fullPath.split("/");
    return parts.slice(0, -1).join("/");
  }

  search(query: string): ContextItem[] {
    if (!query.trim()) {
      return this.docFiles.slice(0, 20);
    }

    const lowerQuery = query.toLowerCase();
    const scored = this.docFiles
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
    return this.docFiles.slice(0, 20);
  }
}
