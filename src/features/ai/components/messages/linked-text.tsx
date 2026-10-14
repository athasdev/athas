import type { ReactNode } from "react";
import { TextLink } from "@/ui/text-link";
import { openWebLink } from "@/utils/external-navigation";

const WEB_URL = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** Plain text, such as command output, with its web addresses made clickable. */
export function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(WEB_URL)) {
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <TextLink
        key={`${start}:${url}`}
        href={url}
        onClick={(event) => {
          event.preventDefault();
          void openWebLink(url, event.currentTarget);
        }}
      >
        {url}
      </TextLink>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
