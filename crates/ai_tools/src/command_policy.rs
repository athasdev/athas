//! Which shell commands Athas's own agent may run without asking. Only simple commands qualify:
//! one program with plain arguments, no pipes, redirects, substitutions, chaining, or variables,
//! so an approved prefix can never smuggle a second command along with it.
//!
//! Ported from Athas's `features/ai/intelligence/lib/intelligence-command-policy.ts`.

use std::sync::LazyLock;

use regex::Regex;

/// Programs whose first argument names what they do, so a prefix keeps it: `bun test`.
const SUBCOMMAND_PROGRAMS: &[&str] = &[
    "bun", "bunx", "cargo", "deno", "docker", "dotnet", "gh", "git", "go", "gradle", "kubectl", "make", "mvn", "npm", "npx",
    "pnpm", "poetry", "uv", "vp", "yarn",
];

/// Programs that are never run without asking, whatever the user allowed before.
const DESTRUCTIVE_PROGRAMS: &[&str] = &[
    "chmod", "chown", "curl", "dd", "del", "doas", "erase", "format", "kill", "killall", "mkfs", "mv", "pkill", "rd", "reboot",
    "rm", "rmdir", "shutdown", "su", "sudo", "truncate", "wget",
];

fn destructive_subcommands(program: &str) -> &'static [&'static str] {
    match program {
        "git" => &[
            "checkout",
            "clean",
            "filter-branch",
            "gc",
            "push",
            "rebase",
            "reset",
            "restore",
            "rm",
            "stash",
            "switch",
            "update-ref",
        ],
        "docker" => &["rm", "rmi", "prune", "kill", "stop", "system", "volume"],
        "kubectl" => &["delete", "drain", "apply", "replace", "scale"],
        "npm" => &["publish", "unpublish"],
        "cargo" => &["publish"],
        "gh" => &["repo", "release", "secret"],
        _ => &[],
    }
}

/// Read-only commands that run without asking: they cannot change files or reach the network.
const SAFE_PROGRAMS: &[&str] = &["cat", "du", "file", "grep", "head", "ls", "pwd", "rg", "stat", "tail", "tree", "wc", "which"];

const SAFE_GIT_SUBCOMMANDS: &[&str] = &["blame", "diff", "log", "ls-files", "rev-parse", "show", "status"];

fn regex(source: &str) -> Regex {
    Regex::new(source).expect("valid pattern")
}

static SHELL_SYNTAX: LazyLock<Regex> = LazyLock::new(|| regex(r"[;&|<>`$\\\n\r(){}]"));
static ENV_ASSIGNMENT: LazyLock<Regex> = LazyLock::new(|| regex(r"^[A-Za-z_][A-Za-z0-9_]*="));
/// Flags that turn an otherwise read-only command into one that writes or runs something.
static UNSAFE_FLAGS: LazyLock<Regex> =
    LazyLock::new(|| regex(r"^(--output|--ext-diff|--exec|--pre\b|--pre=|-exec|-execdir|-ok|-delete|-fprint)"));
/// Shell wildcards: the shell expands them to paths the checks below never saw.
static GLOB: LazyLock<Regex> = LazyLock::new(|| regex(r"[*?\[]"));
static SECRET_ARGUMENT: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)(^|[/:])\.env(\.|$)|\.(pem|key|p12|pfx)$|id_(rsa|ed25519|ecdsa|dsa)"));
static OUTSIDE_PATH: LazyLock<Regex> = LazyLock::new(|| regex(r"^(/|~|[A-Za-z]:)"));
static SUBCOMMAND_NAME: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)^[a-z][\w:.-]*$"));
static GIT_BRANCH_CHANGE: LazyLock<Regex> = LazyLock::new(|| regex(r"^-[dDmMcC]"));
static GIT_BRANCH_LIST: LazyLock<Regex> = LazyLock::new(|| regex(r"^(-a|-r|-v|-vv|--list|--show-current)$"));

/// Flags that make one program write, run something, or read past the workspace's ignore rules:
/// `sed -i` edits in place, `tree -o` and `file -C` write files, `rg --hostname-bin` runs a
/// program, and a recursive `grep` reads ignored secrets such as `.env`.
fn unsafe_program_flags(program: &str) -> Option<&'static Regex> {
    static SED: LazyLock<Regex> = LazyLock::new(|| regex(r"^(-[a-zA-Z]*i|--in-place)"));
    static PERL: LazyLock<Regex> = LazyLock::new(|| regex(r"^-[a-zA-Z]*i"));
    static TREE: LazyLock<Regex> = LazyLock::new(|| regex(r"^(-[a-zA-Z]*o|--output)"));
    static FILE: LazyLock<Regex> = LazyLock::new(|| regex(r"^(-[a-zA-Z]*C|--compile)"));
    static RG: LazyLock<Regex> = LazyLock::new(|| regex(r"^--hostname-bin"));
    static GREP: LazyLock<Regex> = LazyLock::new(|| regex(r"^(-[a-zA-Z]*[rR]|--recursive|--dereference-recursive)"));
    match program {
        "sed" => Some(&SED),
        "perl" => Some(&PERL),
        "tree" => Some(&TREE),
        "file" => Some(&FILE),
        "rg" => Some(&RG),
        "grep" => Some(&GREP),
        _ => None,
    }
}

/// The part of an argument that can name a path: the word itself, or a flag's value.
fn argument_value(word: &str) -> Option<&str> {
    if !word.starts_with('-') {
        return Some(word);
    }
    if let Some(index) = word.find('=') {
        return Some(&word[index + 1..]);
    }
    // A short flag can carry its value attached, as in `-f/etc/passwd`.
    (!word.starts_with("--") && word.chars().count() > 2).then(|| &word[word.char_indices().nth(2).map_or(word.len(), |(index, _)| index)..])
}

/// The arguments of a simple command that could name files, for checking where they lead once
/// symbolic links are followed. Empty for a command with shell syntax, which never runs unasked.
pub fn command_path_arguments(command: &str) -> Vec<String> {
    let Some(words) = split_simple_command(command) else { return Vec::new() };
    words.iter().skip(1).filter_map(|word| argument_value(word)).filter(|value| !value.is_empty()).map(str::to_string).collect()
}

/// Arguments that stay inside the workspace and away from credentials: no absolute or home paths,
/// no `..`, no secret files. Commands run without asking only when every argument passes, since
/// their output goes to the model provider.
fn arguments_stay_in_workspace(words: &[String]) -> bool {
    words.iter().skip(1).all(|word| {
        if GLOB.is_match(word) {
            return false;
        }
        let Some(value) = argument_value(word) else { return true };
        !OUTSIDE_PATH.is_match(value) && !value.split(['/', '\\']).any(|part| part == "..") && !SECRET_ARGUMENT.is_match(value)
    })
}

/// Splits a simple command into words; `None` when it uses shell syntax or unbalanced quotes.
fn split_simple_command(command: &str) -> Option<Vec<String>> {
    let trimmed = command.trim();
    if trimmed.is_empty() || SHELL_SYNTAX.is_match(trimmed) {
        return None;
    }
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for ch in trimmed.chars() {
        if let Some(open) = quote {
            if ch == open {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            started = true;
            continue;
        }
        if ch.is_whitespace() {
            if started {
                words.push(std::mem::take(&mut current));
            }
            current.clear();
            started = false;
            continue;
        }
        current.push(ch);
        started = true;
    }
    if quote.is_some() {
        return None;
    }
    if started {
        words.push(current);
    }
    if words.is_empty() || ENV_ASSIGNMENT.is_match(&words[0]) {
        return None;
    }
    Some(words)
}

fn program_name(word: &str) -> String {
    let name = word.rsplit(['/', '\\']).next().unwrap_or(word).to_lowercase();
    name.strip_suffix(".exe").map(str::to_string).unwrap_or(name)
}

fn is_destructive(words: &[String]) -> bool {
    let program = program_name(&words[0]);
    if DESTRUCTIVE_PROGRAMS.contains(&program.as_str()) {
        return true;
    }
    let subcommand = words.get(1).map(|word| word.to_lowercase());
    if let Some(subcommand) = &subcommand
        && destructive_subcommands(&program).contains(&subcommand.as_str())
    {
        return true;
    }
    program == "git" && subcommand.as_deref() == Some("branch") && words.iter().any(|word| GIT_BRANCH_CHANGE.is_match(word))
}

fn has_unsafe_flag(words: &[String]) -> bool {
    let program_flags = unsafe_program_flags(&program_name(&words[0]));
    words
        .iter()
        .skip(1)
        .any(|word| UNSAFE_FLAGS.is_match(word) || program_flags.is_some_and(|flags| flags.is_match(word)))
}

/// Whether a program that takes a subcommand got an option before it, as in `git -c k=v log`.
/// Global options can run programs or change what the subcommand does, and they hide the
/// subcommand from the destructive check.
fn has_global_option(words: &[String]) -> bool {
    SUBCOMMAND_PROGRAMS.contains(&program_name(&words[0]).as_str()) && words.get(1).is_some_and(|word| word.starts_with('-'))
}

/// A read-only command from the built-in list, safe to run without asking.
pub fn is_builtin_safe_command(command: &str) -> bool {
    let Some(words) = split_simple_command(command) else { return false };
    if !arguments_stay_in_workspace(&words) || has_unsafe_flag(&words) {
        return false;
    }
    let program = program_name(&words[0]);
    if program != words[0] {
        return false;
    }
    if program == "git" {
        return match words.get(1).map(String::as_str) {
            Some("branch") => words.iter().skip(2).all(|word| GIT_BRANCH_LIST.is_match(word)),
            Some(subcommand) => SAFE_GIT_SUBCOMMANDS.contains(&subcommand),
            None => false,
        };
    }
    SAFE_PROGRAMS.contains(&program.as_str())
}

/// The prefix an "always allow" answer remembers for `command`, such as `bun test` or `ls`;
/// `None` when the command must always be confirmed: it uses shell syntax or can destroy data.
pub fn command_allow_prefix(command: &str) -> Option<String> {
    let words = split_simple_command(command)?;
    if is_destructive(&words) || has_global_option(&words) {
        return None;
    }
    let program = &words[0];
    match words.get(1) {
        Some(subcommand) if SUBCOMMAND_PROGRAMS.contains(&program_name(program).as_str()) && SUBCOMMAND_NAME.is_match(subcommand) => {
            Some(format!("{program} {subcommand}"))
        }
        _ => Some(program.clone()),
    }
}

/// Whether `command` starts with one of the remembered prefixes and is still safe to run.
pub fn matches_allowed_prefix(command: &str, prefixes: &[String]) -> bool {
    let Some(words) = split_simple_command(command) else { return false };
    if is_destructive(&words) || has_global_option(&words) || has_unsafe_flag(&words) || !arguments_stay_in_workspace(&words) {
        return false;
    }
    prefixes.iter().any(|prefix| prefix.split(' ').enumerate().all(|(index, word)| words.get(index).is_some_and(|candidate| candidate == word)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_commands_inside_the_workspace_run_unasked() {
        for command in ["ls src", "git status", "git log --oneline", "rg needle src", "git branch --show-current", "cat 'my file.txt'"] {
            assert!(is_builtin_safe_command(command), "{command}");
        }
        for command in [
            "ls | wc",
            "ls; rm x",
            "rm -rf build",
            "sed -i s/a/b/ file",
            "cat ../secret",
            "cat .env",
            "cat /etc/passwd",
            "cat ~/notes",
            "ls *.rs",
            "grep -r token .",
            "git push",
            "git branch -D old",
            "find . -name x",
            "/bin/ls",
            "FOO=1 ls",
            "echo $HOME",
            "cat 'unbalanced",
            "git -c core.pager=x log",
            "cat id_rsa",
        ] {
            assert!(!is_builtin_safe_command(command), "{command}");
        }
    }

    #[test]
    fn always_allow_remembers_a_prefix_only_for_safe_commands() {
        assert_eq!(command_allow_prefix("cargo test -p ai_tools").as_deref(), Some("cargo test"));
        assert_eq!(command_allow_prefix("ls -la").as_deref(), Some("ls"));
        assert_eq!(command_allow_prefix("bun run build").as_deref(), Some("bun run"));
        assert_eq!(command_allow_prefix("git push"), None);
        assert_eq!(command_allow_prefix("rm file"), None);
        assert_eq!(command_allow_prefix("cargo test && rm x"), None);
        assert_eq!(command_allow_prefix("git -C other log"), None);
    }

    #[test]
    fn remembered_prefixes_match_word_by_word() {
        let prefixes = vec!["cargo test".to_string(), "make".to_string()];
        assert!(matches_allowed_prefix("cargo test -p ai_tools", &prefixes));
        assert!(matches_allowed_prefix("make", &prefixes));
        assert!(!matches_allowed_prefix("cargo testing", &prefixes));
        assert!(!matches_allowed_prefix("cargo build", &prefixes));
        assert!(!matches_allowed_prefix("cargo test ../other", &prefixes));
        assert!(!matches_allowed_prefix("cargo test; rm x", &prefixes));
        assert!(!matches_allowed_prefix("cargo publish", &["cargo publish".to_string()]));
    }

    #[test]
    fn path_arguments_include_flag_values() {
        assert_eq!(command_path_arguments("cat -n src/a.rs --file=b.txt -fc.txt -v"), vec!["src/a.rs", "b.txt", "c.txt"]);
        assert!(command_path_arguments("cat a | b").is_empty());
    }
}
