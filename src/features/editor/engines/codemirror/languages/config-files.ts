import { athasSimpleMode } from "./stream-tokens";

/** `.gitignore` and the other ignore files: patterns, negations and comments. */
export const gitignore = athasSimpleMode({
  start: [
    { sol: true, regex: /\s*#.*/, token: "comment" },
    { sol: true, regex: /\s*!/, token: "operator" },
    { regex: /\\[#! ]/, token: "escape" },
    { regex: /\*\*|[/?*[\]]/, token: "operator" },
    { regex: /[^/?*[\]\\\s]+/, token: "string" },
  ],
  languageData: { name: "gitignore", commentTokens: { line: "#" } },
});

/** `.gitattributes`: a path pattern followed by set, unset and valued attributes. */
export const gitattributes = athasSimpleMode({
  start: [
    { sol: true, regex: /\s*#.*/, token: "comment" },
    { sol: true, regex: /\s*\[attr\]\S+/, token: "attributeName" },
    { sol: true, regex: /\S+/, token: "string" },
    { regex: /[!-](?=[A-Za-z0-9_.-])/, token: "operator" },
    { regex: /[A-Za-z0-9_.-]+(?==)/, token: "propertyName" },
    { regex: /=/, token: "operator" },
    { regex: /[A-Za-z0-9_.-]+/, token: "propertyName" },
  ],
  languageData: { name: "gitattributes", commentTokens: { line: "#" } },
});

/** Lockfiles that are neither JSON nor TOML, such as `yarn.lock` and `pnpm-lock.yaml`. */
export const lockfile = athasSimpleMode({
  start: [
    { regex: /\s*#.*/, token: "comment" },
    { regex: /("[^"]+"|'[^']+'|[^:\s"'#][^:]*?)(?=:(?:\s|$))/, token: "propertyName" },
    { regex: /"(?:[^"\\]|\\.)*"?/, token: "string" },
    { regex: /'(?:[^'\\]|\\.)*'?/, token: "string" },
    { regex: /(?:true|false)\b/, token: "bool" },
    { regex: /null\b/, token: "null" },
    { regex: /\d+(?:\.\d+)*\b/, token: "number" },
    { regex: /[{}[\]]/, token: "bracket" },
    { regex: /[,:]/, token: "punctuation" },
    { regex: /[^\s,:{}[\]"']+/, token: "string" },
  ],
  languageData: { name: "lockfile", commentTokens: { line: "#" } },
});

/** Windows batch files (`.bat`, `.cmd`). */
export const batch = athasSimpleMode({
  start: [
    { regex: /(?:rem|REM|Rem)(?:\s.*|$)/, token: "comment" },
    { regex: /::.*/, token: "comment" },
    { sol: true, regex: /\s*:[A-Za-z_][\w.-]*/, token: "labelName" },
    {
      regex: /%%~?[A-Za-z]|%~[a-zA-Z]*\d|%\d|%[A-Za-z_][\w]*(?::[^%]*)?%|![A-Za-z_]\w*!/,
      token: "variableName",
    },
    { regex: /"(?:[^"])*"?/, token: "string" },
    { regex: /@/, token: "operator" },
    {
      regex: /[A-Za-z_][\w-]*/,
      token: (match) =>
        /^(?:if|else|for|in|do|goto|call|exit|not|exist|defined|errorlevel|equ|neq|lss|leq|gtr|geq|setlocal|endlocal|enabledelayedexpansion|shift|pause|echo|set|cd|chdir|pushd|popd|start|cls|title|type|copy|del|erase|move|ren|rename|md|mkdir|rd|rmdir|dir|choice|timeout|on|off|nul)$/i.test(
          match[0],
        )
          ? "keyword"
          : null,
    },
    { regex: /\d+/, token: "number" },
    { regex: /==|[<>|&()]/, token: "operator" },
  ],
  languageData: { name: "batch", commentTokens: { line: "REM " } },
});

/** Vim script (`.vimrc`, `.vim`). */
export const vimscript = athasSimpleMode({
  start: [
    { sol: true, regex: /\s*".*/, token: "comment" },
    { regex: /'(?:[^']|'')*'?/, token: "string" },
    { regex: /"(?:[^"\\]|\\.)*"/, token: "string" },
    { regex: /[gslabwtv]:[A-Za-z_][\w#]*|&[a-z]+|@[a-z"]|\$[A-Z_]+/, token: "variableName" },
    { regex: /<[A-Za-z-]+>/, token: "atom" },
    { regex: /0x[0-9a-fA-F]+|\d+(?:\.\d+)?/, token: "number" },
    {
      regex: /(function!?|fu!?|fun!?)(\s+)([A-Za-z_][\w#:.]*)/,
      token: ["keyword", "", "fn"],
    },
    { regex: /[A-Za-z_][\w#]*(?=\()/, token: "fn" },
    {
      regex: /[A-Za-z_][\w]*/,
      token: (match) =>
        /^(?:let|unlet|const|set|setlocal|if|elseif|else|endif|for|endfor|while|endwhile|try|catch|finally|endtry|function|endfunction|endf|return|call|execute|exe|echo|echom|echomsg|echoerr|augroup|autocmd|au|command|map|nmap|vmap|xmap|imap|omap|cmap|noremap|nnoremap|vnoremap|xnoremap|inoremap|onoremap|cnoremap|syntax|highlight|hi|filetype|source|runtime|silent|normal|in|is|isnot|abort|range|dict|break|continue|finish|throw|colorscheme|packadd|lua|endlua)$/.test(
          match[0],
        )
          ? "keyword"
          : null,
    },
    { regex: /[=!<>]=?[#?]?|[-+*/.%]=?|&&|\|\|/, token: "operator" },
    { regex: /[{}[\]()]/, token: "bracket" },
  ],
  languageData: { name: "vim", commentTokens: { line: '"' } },
});

/** reStructuredText: section titles, directives, roles, literals and inline markup. */
export const restructuredText = athasSimpleMode({
  start: [
    { sol: true, regex: /([=\-`:'"~^_*+#<>])\1{2,}\s*$/, token: "heading" },
    { sol: true, regex: /\.\.\s+[\w-]+::/, token: "keyword" },
    { sol: true, regex: /\.\.\s+_[^:]+:/, token: "labelName" },
    { sol: true, regex: /\.\.\s+\[[^\]]+\]/, token: "labelName" },
    { sol: true, regex: /\.\.(?:\s.*|$)/, token: "comment" },
    { sol: true, regex: /\s*:[\w -]+:/, token: "propertyName" },
    { sol: true, regex: /\s*(?:[-*+•]|\d+\.|#\.)\s/, token: "list" },
    { regex: /``[^`]+``/, token: "monospace" },
    { regex: /:[\w-]+:`[^`]*`/, token: "link" },
    { regex: /`[^`]+`_{1,2}/, token: "link" },
    { regex: /`[^`]+`/, token: "emphasis" },
    { regex: /\*\*[^*]+\*\*/, token: "strong" },
    { regex: /\*[^*\s][^*]*\*/, token: "emphasis" },
    { regex: /\|[^|\s][^|]*\|/, token: "variableName" },
    { regex: /https?:\/\/\S+/, token: "url" },
    { regex: /[^`*|:h]+|./, token: null },
  ],
  languageData: { name: "restructuredtext" },
});
