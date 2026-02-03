import { source } from "@/lib/source";

export function GET() {
  const pages = source.getPages();
  const content = pages
    .map((page) => `- [${page.data.title}](${page.url}): ${page.data.description || ""}`)
    .join("\n");

  return new Response(
    `# Athas Documentation\n\n${content}`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  );
}
