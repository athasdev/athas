// Generated from the landing page project. Paths are relative to DEMO_ROOT.
export const DEMO_HOME = "/Users/you";
export const DEMO_ROOT = "/Users/you/athasdev/www";

export const demoFiles: Record<string, string> = {
  ".github/workflows/deploy.yml":
    "name: Deploy\n\non:\n  push:\n    branches: [main]\n\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: oven-sh/setup-bun@v2\n      - run: bun install --frozen-lockfile\n      - run: bun run typecheck\n      - run: bun run build\n      - name: Ship\n        run: bunx vercel deploy --prod # uses VERCEL_TOKEN\n        env:\n          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}",
  "src/app/layout.tsx":
    'import type { Metadata } from "next";\nimport "./globals.css";\n\nexport const metadata: Metadata = {\n  title: "Athas",\n  description: "The lightweight editor for humans and agents.",\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <body className="antialiased">{children}</body>\n    </html>\n  );\n}',
  "src/app/page.tsx":
    'import { Hero } from "@/components/hero";\nimport { getLatestRelease } from "@/lib/releases";\n\nexport const revalidate = 3600;\n\nexport default async function Page() {\n  const release = await getLatestRelease();\n\n  return (\n    <main className="mx-auto max-w-6xl px-6">\n      <Hero\n        title="Your code. Your agents."\n        version={release.version}\n        downloads={release.downloads}\n      />\n    </main>\n  );\n}',
  "src/lib/releases.ts":
    'type Release = {\n  version: string;\n  downloads: number;\n};\n\nconst RELEASES_URL = "https://api.github.com/repos/athasdev/athas/releases/latest";\n\nexport async function getLatestRelease(): Promise<Release> {\n  const response = await fetch(RELEASES_URL, { next: { revalidate: 3600 } });\n  const release = await response.json();\n\n  return {\n    version: release.tag_name,\n    downloads: countDownloads(release.assets),\n  };\n}\n\nfunction countDownloads(assets: { download_count: number }[]) {\n  return assets.reduce((total, asset) => total + asset.download_count, 0);\n}',
  "public/robots.txt": "User-agent: *\nAllow: /\n\nSitemap: https://athas.dev/sitemap.xml",
  ".env.local": "DATABASE_URL=file:./sqlite.db\nNEXT_PUBLIC_SITE_URL=http://localhost:3000",
  ".gitignore": "node_modules\n.next\n.env.local\nsqlite.db*\n*.tsbuildinfo",
  "AGENTS.md":
    '# AGENTS.md\n\n## Workflow\n\n- Use `bun` for scripts and dependencies.\n- Run `bun run typecheck` before you commit.\n- Keep components in `src/components` flat.\n\n## Style\n\n- Server components by default. Add `"use client"` only for interaction.\n- Colors come from the theme tokens in `globals.css`.',
  "biome.json":
    '{\n  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",\n  "formatter": {\n    "indentStyle": "space",\n    "lineWidth": 100\n  },\n  "linter": {\n    "enabled": true\n  }\n}',
  "next.config.ts":
    'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  reactCompiler: true,\n  images: {\n    formats: ["image/avif", "image/webp"],\n  },\n};\n\nexport default nextConfig;',
  "package.json":
    '{\n  "name": "www",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "next dev",\n    "build": "next build",\n    "start": "next start",\n    "typecheck": "tsc --noEmit",\n    "lint": "biome check ."\n  },\n  "dependencies": {\n    "next": "16.0.0",\n    "react": "19.2.0",\n    "react-dom": "19.2.0"\n  },\n  "devDependencies": {\n    "@biomejs/biome": "2.0.0",\n    "typescript": "5.9.3"\n  }\n}',
  "README.md":
    "# athas.dev\n\nThe website for Athas, the lightweight editor for humans and agents.\n\n## Development\n\n- `bun install`\n- `bun run dev` and open http://localhost:3000",
  "tsconfig.json":
    '{\n  "compilerOptions": {\n    "target": "ES2017",\n    "lib": ["dom", "dom.iterable", "esnext"],\n    "allowJs": true,\n    "skipLibCheck": true,\n    "strict": true,\n    "noEmit": true,\n    "esModuleInterop": true,\n    "module": "esnext",\n    "moduleResolution": "bundler",\n    "resolveJsonModule": true,\n    "isolatedModules": true,\n    "jsx": "react-jsx",\n    "incremental": true,\n    "plugins": [\n      {\n        "name": "next"\n      }\n    ],\n    "paths": {\n      "@/*": ["./src/*"]\n    }\n  },\n  "include": [\n    "next-env.d.ts",\n    "**/*.ts",\n    "**/*.tsx",\n    ".next/types/**/*.ts"\n  ],\n  "exclude": ["node_modules", "scripts"]\n}',
  "src/components/hero.tsx":
    'type HeroProps = {\n  title: string;\n  version: string;\n  downloads: number;\n};\n\nexport function Hero({ title, version, downloads }: HeroProps) {\n  return (\n    <section className="py-24 text-center">\n      <p className="text-sm text-neutral-500">Athas {version}</p>\n      <h1 className="mt-4 text-5xl font-semibold tracking-tight">{title}</h1>\n      <p className="mt-6 text-neutral-600">\n        {downloads.toLocaleString()} downloads and counting.\n      </p>\n    </section>\n  );\n}\n',
  "src/app/globals.css":
    '@import "tailwindcss";\n\n:root {\n  --background: #ffffff;\n  --foreground: #1a1c1e;\n}\n\nbody {\n  background: var(--background);\n  color: var(--foreground);\n}\n',
};
