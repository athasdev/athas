import { parseGitHubEntityLink } from "./github-link-utils";

const GITHUB_ATTACHMENT_PATH_PREFIX = "/user-attachments/assets/";
const PROTECTED_MARKDOWN_SEGMENT = /(`+[^`]*`+|!?\[[^\]]*\]\([^)]+\)|<[^>]+>)/g;
const BARE_URL_PATTERN = /(^|[^\w"'(<[\]/])(https?:\/\/[^\s<>"']+)/g;
const TRAILING_URL_PUNCTUATION = /[.,;:!?'"]+$/;

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

      const autolinked = linkBareUrls(line, normalizedRepositoryUrl);
      return normalizedRepositoryUrl
        ? linkGitHubReferences(autolinked, normalizedRepositoryUrl)
        : autolinked;
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

function splitTrailingPunctuation(url: string): [string, string] {
  let value = url;
  let trailing = "";
  for (;;) {
    const punctuation = value.match(TRAILING_URL_PUNCTUATION);
    if (punctuation) {
      value = value.slice(0, -punctuation[0].length);
      trailing = punctuation[0] + trailing;
      continue;
    }
    const openParens = (value.match(/\(/g) ?? []).length;
    const closeParens = (value.match(/\)/g) ?? []).length;
    if (value.endsWith(")") && closeParens > openParens) {
      value = value.slice(0, -1);
      trailing = `)${trailing}`;
      continue;
    }
    return [value, trailing];
  }
}

/**
 * Turns bare URLs into Markdown links the way GitHub renders them. Links to
 * issues, pull requests and commits of the current repository get GitHub's
 * short form (#12, abc1234) so bodies stay readable.
 */
function linkBareUrls(line: string, repositoryUrl: string | null): string {
  return transformUnprotectedMarkdown(line, (segment) =>
    segment.replace(BARE_URL_PATTERN, (_match, prefix: string, rawUrl: string) => {
      const [url, trailing] = splitTrailingPunctuation(rawUrl);
      if (!url) return `${prefix}${rawUrl}`;
      return `${prefix}[${describeBareUrl(url, repositoryUrl)}](${url})${trailing}`;
    }),
  );
}

function describeBareUrl(url: string, repositoryUrl: string | null): string {
  const entityLink = repositoryUrl ? parseGitHubEntityLink(url) : null;
  if (entityLink && `https://github.com/${entityLink.owner}/${entityLink.repo}` === repositoryUrl) {
    if (entityLink.kind === "pullRequest" || entityLink.kind === "issue") {
      return `#${entityLink.number}`;
    }
    if (entityLink.kind === "commit") return entityLink.sha.slice(0, 7);
  }
  return url;
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
