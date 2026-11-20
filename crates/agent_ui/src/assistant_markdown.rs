//! Replies cleaned up before they are parsed: prose an agent wrapped in a plain fence is unwrapped,
//! and source code under a bare language label ("TypeScript" then code) gets its fence.
//!
//! Athas does this in `features/ai/lib/assistant-markdown.ts`.

const LANGUAGE_HINTS: &[&str] = &[
    "bash", "c", "cpp", "csharp", "css", "dart", "diff", "docker", "elixir", "erlang", "go", "graphql", "haskell", "html", "java", "javascript", "json", "jsx",
    "kotlin", "lua", "makefile", "markdown", "markup", "nginx", "objectivec", "perl", "php", "python", "r", "ruby", "rust", "scala", "scss", "shell", "sql",
    "swift", "toml", "tsx", "typescript", "vim", "xml", "yaml",
];

const CODE_KEYWORDS: &[&str] = &[
    "let", "const", "var", "fn", "def", "class", "import", "export", "if", "for", "while", "match", "return", "use", "pub", "impl", "select", "from", "insert",
    "update", "delete",
];

const CODE_TOKENS: &[&str] = &["=>", "::", "->", ":=", "==", "!=", "<=", ">=", "&&", "||"];

/// A code fence's language under its canonical name (`ts` reads as `typescript`).
pub fn normalize_language(language: &str) -> String {
    let lower = language.trim().to_lowercase();
    let alias = match lower.as_str() {
        "ts" => "typescript",
        "js" => "javascript",
        "py" => "python",
        "rmd" => "r",
        "rb" => "ruby",
        "rs" => "rust",
        "sh" | "shell" | "zsh" | "fish" => "bash",
        "env" => "dotenv",
        "yml" => "yaml",
        "md" | "mdx" => "markdown",
        "cs" => "csharp",
        "kt" => "kotlin",
        "cc" | "c++" | "cxx" | "hpp" => "cpp",
        "h" => "c",
        "dockerfile" => "docker",
        "tf" => "hcl",
        "vue" | "svelte" | "html" | "xml" | "svg" | "htm" => "markup",
        "objc" | "objective-c" => "objectivec",
        "hs" => "haskell",
        "ex" | "exs" => "elixir",
        "erl" => "erlang",
        "clj" => "clojure",
        "gql" => "graphql",
        "tex" => "latex",
        "mk" => "makefile",
        _ => return lower,
    };
    alias.to_string()
}

fn looks_like_code(line: &str) -> bool {
    if line.chars().any(|ch| matches!(ch, '{' | '}' | '(' | ')' | '[' | ']' | ';')) || CODE_TOKENS.iter().any(|token| line.contains(token)) {
        return true;
    }
    let indent = line.len() - line.trim_start().len();
    if indent >= 2 && !line.trim().is_empty() && line[..indent].chars().all(char::is_whitespace) {
        return true;
    }
    let word: String = line.chars().take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_').collect();
    CODE_KEYWORDS.contains(&word.to_lowercase().as_str())
}

fn is_markdown_structure(trimmed: &str) -> bool {
    let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
    if (1..=6).contains(&hashes) && trimmed[hashes..].starts_with(char::is_whitespace) {
        return true;
    }
    if trimmed.starts_with('>') {
        return true;
    }
    let mut chars = trimmed.chars();
    if matches!(chars.next(), Some('-' | '*' | '+')) && chars.next().is_some_and(char::is_whitespace) {
        return true;
    }
    let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
    digits > 0 && trimmed[digits..].starts_with('.') && trimmed[digits + 1..].starts_with(char::is_whitespace)
}

fn is_likely_source_code_line(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty() && !is_markdown_structure(trimmed) && trimmed.split_whitespace().count() < 5 && looks_like_code(line)
}

fn is_likely_implicit_code_line(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty() && !is_markdown_structure(trimmed) && looks_like_code(line)
}

/// A whole reply wrapped in a ``` / ```text / ```markdown fence that holds prose, unwrapped.
pub fn normalize_plain_text_fence(text: &str) -> String {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else { return text.to_string() };
    let Some(newline) = rest.find('\n') else { return text.to_string() };
    let info = rest[..newline].trim_end_matches([' ', '\t']).to_lowercase();
    if !matches!(info.as_str(), "" | "text" | "plaintext" | "markdown") {
        return text.to_string();
    }
    let inner = &rest[newline + 1..];
    let Some(close) = inner.rfind("\n```") else { return text.to_string() };
    if !inner[close + 4..].trim_matches([' ', '\t']).is_empty() {
        return text.to_string();
    }
    let body = inner[..close].trim();
    let lines: Vec<&str> = body.lines().filter(|line| !line.trim().is_empty()).collect();
    if lines.is_empty() || lines.iter().any(|line| is_likely_source_code_line(line)) {
        return text.to_string();
    }
    body.to_string()
}

fn language_hint(line: &str) -> Option<String> {
    let quotes: &[char] = &['"', '\'', '`', '“', '”', '‘', '’'];
    let candidate = line.trim().trim_start_matches(quotes).trim_end_matches(quotes);
    let candidate = candidate.strip_suffix([':', ';', ',']).unwrap_or(candidate).trim();
    let mut chars = candidate.chars();
    let valid = chars.next().is_some_and(|ch| ch.is_ascii_alphabetic())
        && candidate.chars().count() <= 20
        && chars.all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '#' | '.' | '_' | '-'));
    if !valid {
        return None;
    }
    let language = normalize_language(candidate);
    LANGUAGE_HINTS.contains(&language.as_str()).then_some(language)
}

/// Code under a bare language label line, fenced; fences the reply wrote are left alone.
pub fn normalize_implicit_code_fences(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut output: Vec<String> = Vec::with_capacity(lines.len());
    let mut in_fence = false;
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        let is_fence = line.trim_start().starts_with("```");
        if is_fence {
            in_fence = !in_fence;
        }
        if is_fence || in_fence {
            output.push(line.to_string());
            index += 1;
            continue;
        }
        let hint = language_hint(line).filter(|_| lines.get(index + 1).is_some_and(|next| is_likely_implicit_code_line(next)));
        let Some(hint) = hint else {
            output.push(line.to_string());
            index += 1;
            continue;
        };
        output.push(format!("```{hint}"));
        index += 1;
        while let Some(current) = lines.get(index) {
            let trimmed = current.trim();
            if trimmed.is_empty() || trimmed == "\"" || trimmed == "'" {
                break;
            }
            output.push(current.to_string());
            index += 1;
        }
        output.push("```".into());
        if lines.get(index).is_some_and(|line| line.trim().is_empty()) {
            output.push(String::new());
        }
        index += 1;
    }
    output.join("\n")
}

/// A reply as the transcript parses it.
pub fn normalize(text: &str) -> String {
    normalize_implicit_code_fences(&normalize_plain_text_fence(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwraps_prose_in_a_plain_fence() {
        let warning = "```\nModel metadata for `gpt-5.6-sol` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.\n```";
        assert_eq!(
            normalize_plain_text_fence(warning),
            "Model metadata for `gpt-5.6-sol` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."
        );
    }

    #[test]
    fn keeps_fenced_source_code() {
        let code = "```ts\nconst answer = 42;\n```";
        assert_eq!(normalize_plain_text_fence(code), code);
        assert_eq!(normalize_plain_text_fence("```\nlet x = 1;\n```"), "```\nlet x = 1;\n```");
    }

    #[test]
    fn fences_labelled_source_code() {
        assert_eq!(normalize_implicit_code_fences("TypeScript\nconst answer = 42;"), "```typescript\nconst answer = 42;\n```");
    }

    #[test]
    fn leaves_explicit_fences_alone() {
        let fenced = "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nTypeScript\nconst c = 3;";
        assert_eq!(normalize_implicit_code_fences(fenced), "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n```typescript\nconst c = 3;\n```");
    }

    #[test]
    fn prose_after_a_language_word_stays() {
        let text = "Rust\nis a language people like.";
        assert_eq!(normalize_implicit_code_fences(text), text);
    }
}
