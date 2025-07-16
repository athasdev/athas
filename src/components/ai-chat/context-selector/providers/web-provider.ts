import type { ContextItem } from "../types";

export class WebProvider {
  private recentUrls: ContextItem[] = [];
  private urlHistory: string[] = [];

  constructor() {
    // Load from localStorage if available
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const stored = localStorage.getItem("ai-chat-web-history");
      if (stored) {
        this.urlHistory = JSON.parse(stored);
        this.updateRecentUrls();
      }
    } catch (error) {
      console.warn("Failed to load web history:", error);
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem("ai-chat-web-history", JSON.stringify(this.urlHistory));
    } catch (error) {
      console.warn("Failed to save web history:", error);
    }
  }

  private updateRecentUrls() {
    this.recentUrls = this.urlHistory.slice(0, 20).map(url => ({
      id: url,
      name: this.getDisplayName(url),
      description: url,
      type: "url",
      metadata: { url },
    }));
  }

  private getDisplayName(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  }

  private isValidUrl(text: string): boolean {
    try {
      new URL(text);
      return true;
    } catch {
      return false;
    }
  }

  addUrl(url: string) {
    if (!this.isValidUrl(url)) return;

    // Remove if already exists
    this.urlHistory = this.urlHistory.filter(u => u !== url);
    // Add to beginning
    this.urlHistory.unshift(url);
    // Keep only last 50 URLs
    this.urlHistory = this.urlHistory.slice(0, 50);

    this.updateRecentUrls();
    this.saveToStorage();
  }

  search(query: string): ContextItem[] {
    if (!query.trim()) {
      return this.recentUrls;
    }

    const lowerQuery = query.toLowerCase();

    // If it looks like a URL, create a new item for it
    if (this.isValidUrl(query)) {
      const urlItem: ContextItem = {
        id: `new-${query}`,
        name: this.getDisplayName(query),
        description: query,
        type: "url",
        metadata: { url: query, isNew: true },
      };

      // Also search existing URLs
      const existingMatches = this.recentUrls
        .filter(
          item =>
            item.name.toLowerCase().includes(lowerQuery) ||
            item.description?.toLowerCase().includes(lowerQuery),
        )
        .slice(0, 10);

      return [urlItem, ...existingMatches];
    }

    // Search existing URLs
    const scored = this.recentUrls
      .map(item => ({
        item,
        score: this.calculateScore(`${item.name} ${item.description}`.toLowerCase(), lowerQuery),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 20).map(({ item }) => item);
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
    return this.recentUrls;
  }

  getRecentUrls(): ContextItem[] {
    return this.recentUrls;
  }

  clearHistory() {
    this.urlHistory = [];
    this.recentUrls = [];
    this.saveToStorage();
  }
}
