import { source } from "@/lib/source";
import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await params;
  const pageSlug = slug.slice(0, -1);
  const page = source.getPage(pageSlug.length === 0 ? undefined : pageSlug);

  if (!page) notFound();

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          padding: "80px",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "6px",
            background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "40px",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "12px",
              backgroundColor: "#3b82f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "24px",
              fontWeight: "bold",
              color: "white",
            }}
          >
            A
          </div>
          <span style={{ fontSize: "28px", fontWeight: "600", color: "#e5e5e5" }}>
            Athas Docs
          </span>
        </div>
        <div
          style={{
            fontSize: "64px",
            fontWeight: "bold",
            color: "#ffffff",
            lineHeight: 1.1,
            marginBottom: "24px",
            maxWidth: "900px",
          }}
        >
          {page.data.title}
        </div>
        {page.data.description && (
          <div style={{ fontSize: "28px", color: "#a1a1aa", maxWidth: "800px" }}>
            {page.data.description}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: "60px",
            left: "80px",
            color: "#71717a",
            fontSize: "20px",
          }}
        >
          docs.athas.dev
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}

export function generateStaticParams() {
  return source.generateParams().map((params) => ({
    slug: [...(params.slug ?? []), "image.png"],
  }));
}
