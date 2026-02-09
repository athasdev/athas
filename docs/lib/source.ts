import { docs } from "@/.source/server";
import { loader, type InferPageType } from "fumadocs-core/source";
import { icons } from "lucide-react";
import { createElement } from "react";

export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
  icon(icon) {
    if (!icon) return undefined;
    if (icon in icons) {
      return createElement(icons[icon as keyof typeof icons]);
    }
    return undefined;
  },
});

export function getOgImageUrl(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, "image.png"];
  return `/docs/og/docs/${segments.join("/")}`;
}
