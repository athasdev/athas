import { source } from "@/lib/source";

export function GET() {
  const pages = source.getPages();
  const content = pages
    .map((page) => `# ${page.data.title}\n\nURL: ${page.url}\n\n${page.data.description || ""}`)
    .join("\n\n---\n\n");

  return new Response(content, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
