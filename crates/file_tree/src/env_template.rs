//! Env templates (`lib/env-template.ts`): an env file's keys copied to `.env.example` and its
//! siblings with the values left out, comments kept.

pub struct EnvTemplateTarget {
    pub label: &'static str,
    pub file_name: &'static str,
}

pub const ENV_TEMPLATE_TARGETS: &[EnvTemplateTarget] = &[
    EnvTemplateTarget { label: "Create .env.example", file_name: ".env.example" },
    EnvTemplateTarget { label: "Create .env.local", file_name: ".env.local" },
    EnvTemplateTarget { label: "Create .env.development", file_name: ".env.development" },
];

pub fn is_env_file_name(file_name: &str) -> bool {
    let normalized = file_name.trim().to_lowercase();
    normalized == ".env" || normalized.starts_with(".env.")
}

/// Where an inline comment starts in a value (the whitespace before its `#`), outside quotes.
fn inline_comment_start(value: &[char]) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, &c) in value.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' && quote == Some('"') {
            escaped = true;
            continue;
        }
        if (c == '\'' || c == '"') && quote.is_none_or(|open| open == c) {
            quote = if quote.is_some() { None } else { Some(c) };
            continue;
        }
        if c == '#' && quote.is_none() && (index == 0 || value[index - 1].is_whitespace()) {
            return Some(index.saturating_sub(1));
        }
    }
    None
}

/// `^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.*)$`: the assignment's prefix and value.
fn split_assignment(line: &str) -> Option<(&str, &str)> {
    let mut rest = line.trim_start();
    if let Some(after) = rest.strip_prefix("export")
        && after.starts_with(char::is_whitespace)
    {
        rest = after.trim_start();
    }
    let mut chars = rest.char_indices();
    let (_, first) = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    let name_end = chars.find(|(_, c)| !(c.is_ascii_alphanumeric() || *c == '_')).map_or(rest.len(), |(at, _)| at);
    let after_name = rest[name_end..].trim_start();
    let after_equals = after_name.strip_prefix('=')?;
    let value = after_equals.trim_start();
    Some((&line[..line.len() - value.len()], value))
}

pub fn build_env_template_content(content: &str) -> String {
    let trailing_newline = content.ends_with('\n');
    let normalized = content.replace("\r\n", "\n");
    let mut lines: Vec<&str> = normalized.split('\n').collect();
    if trailing_newline {
        lines.pop();
    }
    let lines: Vec<String> = lines
        .into_iter()
        .map(|line| {
            if line.trim().is_empty() || line.trim_start().starts_with('#') {
                return line.to_string();
            }
            let Some((prefix, value)) = split_assignment(line) else { return line.to_string() };
            let chars: Vec<char> = value.chars().collect();
            let comment: String = inline_comment_start(&chars).map(|start| chars[start..].iter().collect()).unwrap_or_default();
            format!("{prefix}{comment}")
        })
        .collect();
    format!("{}{}", lines.join("\n"), if trailing_newline { "\n" } else { "" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates_keep_keys_and_comments_without_values() {
        let source = "# Database\nDATABASE_URL=postgres://x\nexport TOKEN = \"a # b\" # api token\nEMPTY=\nnot an assignment\nURL=http://x#frag\r\n";
        assert_eq!(build_env_template_content(source), "# Database\nDATABASE_URL=\nexport TOKEN =  # api token\nEMPTY=\nnot an assignment\nURL=\n");
        assert_eq!(build_env_template_content("A=1"), "A=");
    }

    #[test]
    fn recognises_env_files() {
        assert!(is_env_file_name(".env"));
        assert!(is_env_file_name(".ENV.local"));
        assert!(!is_env_file_name("env"));
        assert!(!is_env_file_name(".envrc"));
    }
}
