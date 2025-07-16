import type { GitFile } from "../../../../utils/git";
import { getBranches, getGitLog, getGitStatus, getStashes } from "../../../../utils/git";
import type { ContextItem } from "../types";

export class GitProvider {
  private gitItems: ContextItem[] = [];
  private rootPath: string = "";

  setRootPath(path: string) {
    this.rootPath = path;
    this.updateGitItems();
  }

  private async updateGitItems() {
    if (!this.rootPath) return;

    try {
      const items: ContextItem[] = [];

      // Get current status
      const status = await getGitStatus(this.rootPath);
      if (status) {
        // Add current branch info
        items.push({
          id: `branch-${status.branch}`,
          name: `Current Branch: ${status.branch}`,
          description: `${status.ahead} ahead, ${status.behind} behind`,
          type: "git-branch",
          metadata: { branch: status.branch, status },
        });

        // Add staged files
        const stagedFiles = status.files.filter(f => f.staged);
        if (stagedFiles.length > 0) {
          items.push({
            id: "git-staged",
            name: `Staged Files (${stagedFiles.length})`,
            description: stagedFiles.map(f => f.path).join(", "),
            type: "git-staged",
            metadata: { files: stagedFiles },
          });
        }

        // Add unstaged files
        const unstagedFiles = status.files.filter(f => !f.staged && f.status !== "untracked");
        if (unstagedFiles.length > 0) {
          items.push({
            id: "git-unstaged",
            name: `Modified Files (${unstagedFiles.length})`,
            description: unstagedFiles.map(f => f.path).join(", "),
            type: "git-modified",
            metadata: { files: unstagedFiles },
          });
        }

        // Add untracked files
        const untrackedFiles = status.files.filter(f => f.status === "untracked");
        if (untrackedFiles.length > 0) {
          items.push({
            id: "git-untracked",
            name: `Untracked Files (${untrackedFiles.length})`,
            description: untrackedFiles.map(f => f.path).join(", "),
            type: "git-untracked",
            metadata: { files: untrackedFiles },
          });
        }
      }

      // Get recent commits
      const commits = await getGitLog(this.rootPath, 10);
      commits.forEach((commit, _index) => {
        const shortHash = commit.hash.substring(0, 7);
        const shortMessage =
          commit.message.length > 50 ? `${commit.message.substring(0, 50)}...` : commit.message;

        items.push({
          id: `commit-${commit.hash}`,
          name: `${shortHash}: ${shortMessage}`,
          description: `${commit.author} - ${new Date(commit.date).toLocaleDateString()}`,
          type: "git-commit",
          metadata: { commit },
        });
      });

      // Get branches
      const branches = await getBranches(this.rootPath);
      branches.forEach(branch => {
        if (branch !== status?.branch) {
          items.push({
            id: `branch-${branch}`,
            name: `Branch: ${branch}`,
            description: "Branch",
            type: "git-branch-other",
            metadata: { branch: branch },
          });
        }
      });

      // Get stashes
      const stashes = await getStashes(this.rootPath);
      stashes.forEach((stash, _index) => {
        items.push({
          id: `stash-${stash.index}`,
          name: `Stash ${stash.index}: ${stash.message}`,
          description: new Date(stash.date).toLocaleDateString(),
          type: "git-stash",
          metadata: { stash },
        });
      });

      this.gitItems = items;
    } catch (error) {
      console.warn("Failed to load git items:", error);
      this.gitItems = [];
    }
  }

  search(query: string): ContextItem[] {
    if (!query.trim()) {
      return this.gitItems.slice(0, 20);
    }

    const lowerQuery = query.toLowerCase();
    const scored = this.gitItems
      .map(item => ({
        item,
        score: this.calculateScore(
          `${item.name} ${item.description || ""}`.toLowerCase(),
          lowerQuery,
        ),
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
    return this.gitItems.slice(0, 20);
  }

  async refresh() {
    await this.updateGitItems();
  }

  // Generate context text for AI
  generateContextText(item: ContextItem): string {
    switch (item.type) {
      case "git-branch": {
        const status = item.metadata?.status;
        return `Current Git branch: ${item.metadata?.branch}\nStatus: ${status?.ahead} commits ahead, ${status?.behind} commits behind origin`;
      }

      case "git-staged": {
        const stagedFiles = item.metadata?.files || [];
        return `Staged files:\n${stagedFiles.map((f: GitFile) => `- ${f.path} (${f.status})`).join("\n")}`;
      }

      case "git-modified": {
        const modifiedFiles = item.metadata?.files || [];
        return `Modified files:\n${modifiedFiles.map((f: GitFile) => `- ${f.path} (${f.status})`).join("\n")}`;
      }

      case "git-untracked": {
        const untrackedFiles = item.metadata?.files || [];
        return `Untracked files:\n${untrackedFiles.map((f: GitFile) => `- ${f.path}`).join("\n")}`;
      }

      case "git-commit": {
        const commit = item.metadata?.commit;
        return `Git commit ${commit?.hash}:\nAuthor: ${commit?.author}\nDate: ${commit?.date}\nMessage: ${commit?.message}`;
      }

      case "git-branch-other":
        return `Git branch: ${item.metadata?.branch}`;

      case "git-stash": {
        const stash = item.metadata?.stash;
        return `Git stash ${stash?.index}:\nMessage: ${stash?.message}\nDate: ${stash?.date}`;
      }

      default:
        return item.name + (item.description ? `\n${item.description}` : "");
    }
  }
}
