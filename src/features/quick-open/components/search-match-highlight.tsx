import { Fragment } from "react";

interface SearchMatchHighlightProps {
  text: string;
  query: string;
}

export function SearchMatchHighlight({ text, query }: SearchMatchHighlightProps) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return text;

  const normalizedText = text.toLowerCase();
  const parts: Array<{ text: string; matched: boolean }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, cursor);
    if (matchIndex < 0) {
      parts.push({ text: text.slice(cursor), matched: false });
      break;
    }

    if (matchIndex > cursor) {
      parts.push({ text: text.slice(cursor, matchIndex), matched: false });
    }

    const matchEnd = matchIndex + normalizedQuery.length;
    parts.push({ text: text.slice(matchIndex, matchEnd), matched: true });
    cursor = matchEnd;
  }

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={`${part.text}-${index}`}>
          {part.matched ? <span className="font-medium text-accent">{part.text}</span> : part.text}
        </Fragment>
      ))}
    </>
  );
}
