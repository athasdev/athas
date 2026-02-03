import { source } from "@/lib/source";
import { notFound } from "next/navigation";

export async function GET(
  _request: Request,
  props: { params: Promise<{ slug?: string[] }> }
) {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const content = `# ${page.data.title}\n\nURL: ${page.url}\n\n${page.data.description || ""}`;

  return new Response(content, {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.generateParams();
}
