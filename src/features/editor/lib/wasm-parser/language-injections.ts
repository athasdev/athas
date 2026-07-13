import type { Node } from "web-tree-sitter";

export interface InjectionRule {
  parentType: string;
  contentType: string;
  language: string;
}

export interface InjectionNode {
  rule: InjectionRule;
  node: Node;
  parentNode: Node | null;
}

const LANGUAGE_INJECTIONS: Record<string, InjectionRule[]> = {
  angular: [
    { parentType: "script_element", contentType: "raw_text", language: "javascript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
  ],
  html: [
    { parentType: "script_element", contentType: "raw_text", language: "javascript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
  ],
  svelte: [
    { parentType: "script_element", contentType: "raw_text", language: "javascript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
    { parentType: "*", contentType: "raw_text_await", language: "javascript" },
    { parentType: "*", contentType: "raw_text_each", language: "javascript" },
    { parentType: "*", contentType: "raw_text_expr", language: "javascript" },
  ],
  astro: [
    { parentType: "frontmatter", contentType: "frontmatter_js_block", language: "typescript" },
    { parentType: "script_element", contentType: "raw_text", language: "typescript" },
    { parentType: "style_element", contentType: "raw_text", language: "css" },
    { parentType: "*", contentType: "attribute_js_expr", language: "typescript" },
    { parentType: "*", contentType: "permissible_text", language: "typescript" },
  ],
  markdown: [{ parentType: "*", contentType: "html_block", language: "html" }],
};

export function getInjectionRules(languageId: string): InjectionRule[] | undefined {
  return LANGUAGE_INJECTIONS[languageId];
}

export function findInjectionNodes(rootNode: Node, rules: InjectionRule[]): InjectionNode[] {
  const results: InjectionNode[] = [];

  function walk(node: Node) {
    for (const rule of rules) {
      if (rule.parentType === "*") {
        if (node.type === rule.contentType) {
          results.push({ rule, node, parentNode: null });
        }
      } else if (node.type === rule.parentType) {
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child && child.type === rule.contentType) {
            results.push({ rule, node: child, parentNode: node });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  walk(rootNode);
  return results;
}

export function resolveInjectedLanguage(
  source: string,
  parentLanguageId: string,
  rule: InjectionRule,
  node: Node,
  parentNode: Node | null,
): string {
  if (rule.parentType !== "script_element" || !parentNode) {
    return rule.language;
  }

  const openingTag = source.slice(parentNode.startIndex, node.startIndex);
  const langMatch = openingTag.match(/\blang\s*=\s*["']([^"']+)["']/i);
  const lang = langMatch?.[1]?.trim().toLowerCase();

  if (!lang) {
    return rule.language;
  }

  if (lang === "ts" || lang === "typescript") {
    return "typescript";
  }

  if (lang === "js" || lang === "javascript") {
    return "javascript";
  }

  if (parentLanguageId === "svelte" && (lang === "tsx" || lang === "jsx")) {
    return lang === "tsx" ? "typescriptreact" : "javascriptreact";
  }

  return rule.language;
}
