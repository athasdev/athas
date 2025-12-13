import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * Fetches a web page and extracts readable text content
 */
export async function fetchWebPageContent(url: string): Promise<string> {
  if (!url || url === "about:blank") {
    return "";
  }

  try {
    // Use Tauri's fetch to bypass CORS
    const response = await tauriFetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${url}: ${response.status}`);
      return `[Failed to fetch page: ${response.status}]`;
    }

    const html = await response.text();
    return extractTextFromHtml(html, url);
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return `[Error fetching page: ${error}]`;
  }
}

/**
 * Extracts readable text content from HTML
 */
function extractTextFromHtml(html: string, url: string): string {
  // Remove script and style tags with their content
  const text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "");

  // Extract title
  const titleMatch = text.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Extract meta description
  const descMatch = text.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const description = descMatch ? descMatch[1].trim() : "";

  // Extract main content areas (prioritize article, main, etc.)
  let mainContent = "";
  const mainMatch = text.match(/<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i);
  if (mainMatch) {
    mainContent = mainMatch[1];
  } else {
    // Fall back to body content
    const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    mainContent = bodyMatch ? bodyMatch[1] : text;
  }

  // Remove remaining HTML tags
  mainContent = mainContent
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // Build the result
  let result = `URL: ${url}\n`;
  if (title) {
    result += `Title: ${title}\n`;
  }
  if (description) {
    result += `Description: ${description}\n`;
  }
  result += "\nPage Content:\n";

  // Truncate if too long (keep first ~8000 chars for context window)
  const maxLength = 8000;
  if (mainContent.length > maxLength) {
    result += `${mainContent.slice(0, maxLength)}\n... [content truncated]`;
  } else {
    result += mainContent;
  }

  return result;
}
