import { RootProvider } from "fumadocs-ui/provider/next";
import "fumadocs-ui/style.css";
import "./global.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const siteUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://athas.dev";
const basePath = "/docs";
const docsUrl = `${siteUrl}${basePath}`;

export const metadata: Metadata = {
  title: {
    default: "Athas Documentation",
    template: "%s | Athas Docs",
  },
  description: "Documentation for Athas - A lightweight, cross-platform code editor built with Tauri",
  metadataBase: new URL(siteUrl),
  icons: {
    icon: `${basePath}/icon.png`,
    apple: `${basePath}/icon.png`,
  },
  openGraph: {
    title: "Athas Documentation",
    description: "Documentation for Athas - A lightweight, cross-platform code editor built with Tauri",
    url: docsUrl,
    siteName: "Athas Docs",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Athas Documentation",
    description: "Documentation for Athas - A lightweight, cross-platform code editor built with Tauri",
    creator: "@athasindustries",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
