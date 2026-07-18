const GITHUB_ATTACHMENT_PATH_PREFIX = "/user-attachments/assets/";
const PROTECTED_MARKDOWN_SEGMENT = /(`+[^`]*`+|!?\[[^\]]*\]\([^)]+\)|<[^>]+>)/g;

export function normalizeGitHubMarkdown(content: string, repositoryUrl?: string): string {
  const normalizedRepositoryUrl = normalizeRepositoryUrl(repositoryUrl);
  let activeFence: "`" | "~" | null = null;

  return content
    .split("\n")
    .map((line) => {
      const fenceMarker = getFenceMarker(line);
      if (fenceMarker) {
        activeFence = activeFence === fenceMarker ? null : (activeFence ?? fenceMarker);
        return line;
      }

      if (activeFence) return line;

      const attachmentUrl = parseStandaloneGitHubAttachmentUrl(line);
      if (attachmentUrl) {
        const escapedUrl = escapeHtmlAttribute(attachmentUrl);
        return `<video class="github-markdown-attachment" src="${escapedUrl}" controls preload="metadata" playsinline><a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">Open attachment</a></video>`;
      }

      const trimmedLine = line.trim();
      if (trimmedLine.startsWith("<") && trimmedLine.endsWith(">")) return line;

      return normalizedRepositoryUrl ? linkGitHubReferences(line, normalizedRepositoryUrl) : line;
    })
    .join("\n");
}

function normalizeRepositoryUrl(value?: string): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "github.com" && url.hostname !== "www.github.com") ||
      segments.length < 2
    ) {
      return null;
    }

    return `https://github.com/${segments[0]}/${segments[1]}`;
  } catch {
    return null;
  }
}

function getFenceMarker(line: string): "`" | "~" | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/);
  if (!match) return null;
  return match[1][0] as "`" | "~";
}

function parseStandaloneGitHubAttachmentUrl(line: string): string | null {
  const value = line.trim();
  if (!value || /\s/.test(value)) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      !url.pathname.startsWith(GITHUB_ATTACHMENT_PATH_PREFIX)
    ) {
      return null;
    }

    const assetId = url.pathname.slice(GITHUB_ATTACHMENT_PATH_PREFIX.length);
    return assetId && !assetId.includes("/") ? url.toString() : null;
  } catch {
    return null;
  }
}

function linkGitHubReferences(line: string, repositoryUrl: string): string {
  const crossRepositoryReferences = transformUnprotectedMarkdown(line, (segment) =>
    segment.replace(
      /(^|[^\w/])([a-z\d](?:[a-z\d-]*[a-z\d])?)\/([a-z\d._-]+)#(\d+)\b/gi,
      (_match, prefix, owner, repo, issueNumber) => {
        return `${prefix}[${owner}/${repo}#${issueNumber}](https://github.com/${owner}/${repo}/issues/${issueNumber})`;
      },
    ),
  );

  return transformUnprotectedMarkdown(crossRepositoryReferences, (segment) =>
    segment.replace(/(^|[^\w/])#(\d+)\b/g, (_match, prefix, issueNumber) => {
      return `${prefix}[#${issueNumber}](${repositoryUrl}/issues/${issueNumber})`;
    }),
  );
}

function transformUnprotectedMarkdown(
  line: string,
  transform: (segment: string) => string,
): string {
  return line
    .split(PROTECTED_MARKDOWN_SEGMENT)
    .map((segment, index) => (index % 2 === 0 ? transform(segment) : segment))
    .join("");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
