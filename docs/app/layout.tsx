import { RootProvider } from "fumadocs-ui/provider/next";
import "fumadocs-ui/style.css";
import "./global.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://docs.athas.dev";

export const metadata: Metadata = {
  title: {
    default: "Athas Documentation",
    template: "%s | Athas Docs",
  },
  description: "Documentation for Athas - A lightweight, cross-platform code editor built with Tauri",
  metadataBase: new URL(baseUrl),
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    title: "Athas Documentation",
    description: "Documentation for Athas - A lightweight, cross-platform code editor built with Tauri",
    url: baseUrl,
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
