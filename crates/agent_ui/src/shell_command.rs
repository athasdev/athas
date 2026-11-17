//! Shell commands as people read them: the wrapper an agent runs a command through
//! (`/bin/zsh -lc 'bun dev'`) taken off, and launchers dropped for short labels.
//!
//! Ported from Athas's `lib/shell-command.ts`.

const POSIX_SHELLS: &[&str] = &["sh", "bash", "zsh", "dash", "ksh", "fish"];
const POWERSHELLS: &[&str] = &["powershell", "pwsh"];
const MAX_UNWRAPS: usize = 3;
const MAX_SHORT_WORDS: usize = 3;
const SEPARATORS: &[&str] = &["&&", "||", "|", ";", ">", ">>", "<", "2>", "2>&1", "&"];
const PACKAGE_RUNNERS: &[&str] = &["npx", "bunx", "pnpx"];
const DLX_RUNNERS: &[&str] = &["pnpm", "yarn"];
const OPTIONS_WITH_VALUES: &[&str] = &["--using", "--node", "--npm", "--yarn", "--pnpm", "-n"];
const MAX_LAUNCHERS: usize = 8;
const LONG_RUNNING_WORDS: &[&str] = &["dev", "serve", "server", "start", "watch", "preview"];
const LONG_RUNNING_PROGRAMS: &[&str] = &["vite", "nodemon", "http-server", "live-server"];

/// Splits a command line into words, honouring single and double quotes and escapes.
pub fn split_command_words(command: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut has_word = false;
    let mut chars = command.chars().peekable();
    while let Some(char) = chars.next() {
        if let Some(open) = quote {
            if char == open {
                quote = None;
            } else if char == '\\' && open == '"' && chars.peek().is_some() {
                current.extend(chars.next());
            } else {
                current.push(char);
            }
            continue;
        }
        if char == '\'' || char == '"' {
            quote = Some(char);
            has_word = true;
        } else if char == '\\' && chars.peek().is_some() {
            current.extend(chars.next());
            has_word = true;
        } else if char.is_whitespace() {
            if has_word {
                words.push(std::mem::take(&mut current));
            }
            current.clear();
            has_word = false;
        } else {
            current.push(char);
            has_word = true;
        }
    }
    if has_word {
        words.push(current);
    }
    words
}

fn base_name(word: &str) -> &str {
    word.rsplit(['/', '\\']).next().unwrap_or(word)
}

fn program_name(word: &str) -> String {
    let name = base_name(word).to_lowercase();
    name.strip_suffix(".exe").map(str::to_string).unwrap_or(name)
}

fn is_c_flag(word: &str) -> bool {
    word.len() > 1 && word.starts_with('-') && word[1..].chars().all(|char| char.is_ascii_alphabetic()) && word[1..].to_ascii_lowercase().contains('c')
}

/// The script a shell wrapper runs, or `None` when `words` is not a wrapper.
fn unwrap_words(words: &[String]) -> Option<String> {
    let (program, rest) = words.split_first()?;
    let name = program_name(program);
    let joined = |from: usize| Some(rest[from..].join(" ")).filter(|script| !script.is_empty());
    if POSIX_SHELLS.contains(&name.as_str()) {
        for (index, word) in rest.iter().enumerate() {
            if is_c_flag(word) || word == "--command" {
                return rest.get(index + 1).cloned();
            }
            if !word.starts_with('-') {
                return None;
            }
        }
        return None;
    }
    if name == "cmd" {
        let index = rest.iter().position(|word| word.eq_ignore_ascii_case("/c") || word.eq_ignore_ascii_case("/k"))?;
        return joined(index + 1);
    }
    if POWERSHELLS.contains(&name.as_str()) {
        let index = rest.iter().position(|word| word.eq_ignore_ascii_case("-c") || word.eq_ignore_ascii_case("-command"))?;
        return joined(index + 1);
    }
    None
}

fn unwrap_from(mut current: String) -> String {
    for _ in 0..MAX_UNWRAPS {
        let Some(script) = unwrap_words(&split_command_words(&current)) else { break };
        current = script.trim().to_string();
    }
    current
}

/// The command a shell wrapper runs, such as `bun dev` for `/bin/zsh -lc 'bun dev'`,
/// `cmd /c npm test` or `powershell -NoProfile -Command npm test`. Nested wrappers unwrap too.
/// Anything else comes back as it was, trimmed, so the command stays exact.
pub fn unwrap_shell_command(command: &str) -> String {
    unwrap_from(command.trim().to_string())
}

/// [`unwrap_shell_command`] for a command given as its words.
pub fn unwrap_shell_words(words: &[String]) -> String {
    unwrap_from(unwrap_words(words).unwrap_or_else(|| words.join(" ")))
}

fn version_manager_verbs(name: &str) -> &'static [&'static str] {
    match name {
        "mise" => &["exec", "x"],
        "asdf" | "fnm" => &["exec"],
        "nvm" => &["exec", "run"],
        "volta" => &["run"],
        _ => &[],
    }
}

fn is_version(word: &str) -> bool {
    let digits = word.strip_prefix('v').unwrap_or(word);
    word.contains('@') || (!digits.is_empty() && digits.split('.').all(|part| !part.is_empty() && part.chars().all(|char| char.is_ascii_digit())))
}

fn skip_options(words: &[String], from: usize, skip_versions: bool) -> usize {
    let mut index = from;
    while let Some(word) = words.get(index) {
        if word == "--" {
            return index + 1;
        }
        if word.starts_with('-') {
            index += if OPTIONS_WITH_VALUES.contains(&word.as_str()) { 2 } else { 1 };
        } else if skip_versions && is_version(word) {
            index += 1;
        } else {
            break;
        }
    }
    index.min(words.len())
}

fn is_assignment(word: &str) -> bool {
    let Some((name, _)) = word.split_once('=') else { return false };
    let mut chars = name.chars();
    chars.next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_') && chars.all(|char| char.is_ascii_alphanumeric() || char == '_')
}

/// Drops what only launches the command: `cd dir &&`, env assignments, version managers.
fn strip_launchers(input: Vec<String>) -> Vec<String> {
    let mut words = input;
    for _ in 0..MAX_LAUNCHERS {
        let Some(first) = words.first() else { break };
        let name = program_name(first);
        let rest = &words[1..];
        let next = if name == "cd" {
            let Some(at) = words.iter().position(|word| word == "&&") else { break };
            words[at + 1..].to_vec()
        } else if is_assignment(first) {
            rest.to_vec()
        } else if name == "env" {
            let skip = rest.iter().take_while(|word| word.starts_with('-') || word.contains('=')).count();
            rest[skip..].to_vec()
        } else if name == "nohup" || name == "time" {
            rest.to_vec()
        } else if name == "nice" {
            rest[skip_options(rest, 0, false)..].to_vec()
        } else if rest.first().is_some_and(|verb| version_manager_verbs(&name).contains(&verb.as_str())) {
            let from = match rest.iter().position(|word| word == "--") {
                Some(separator) => separator + 1,
                None => skip_options(rest, 1, true),
            };
            rest[from..].to_vec()
        } else if PACKAGE_RUNNERS.contains(&name.as_str()) {
            rest[skip_options(rest, 0, false)..].to_vec()
        } else if DLX_RUNNERS.contains(&name.as_str()) && rest.first().is_some_and(|verb| verb == "dlx") {
            rest[skip_options(rest, 1, false)..].to_vec()
        } else {
            break;
        };
        words = next;
    }
    words
}

fn join_words(words: &[String]) -> String {
    words.iter().map(|word| if word.chars().any(char::is_whitespace) { format!("'{word}'") } else { word.clone() }).collect::<Vec<_>>().join(" ")
}

fn clean_unwrapped(unwrapped: String) -> String {
    let mut words = strip_launchers(split_command_words(&unwrapped));
    if words.is_empty() {
        return unwrapped;
    }
    let program = base_name(&words[0]);
    let program = if program.is_empty() { words[0].clone() } else { program.to_string() };
    words[0] = program.strip_suffix(".exe").or_else(|| program.strip_suffix(".EXE")).map(str::to_string).unwrap_or(program);
    join_words(&words)
}

/// A command as people read it: the shell wrapper, `cd`, env assignments, `nice`/`nohup`/`time`,
/// version managers such as `mise exec node@24 --` and package runners such as `npx` dropped, and
/// the program reduced to its name, so `mise exec node@24 -- ./node_modules/.bin/vp run dev` reads
/// `vp run dev`. For labels only; permission prompts show the exact command.
pub fn clean_command(command: &str) -> String {
    clean_unwrapped(unwrap_shell_command(command))
}

/// [`clean_command`] for a command given as its words.
pub fn clean_command_words(words: &[String]) -> String {
    clean_unwrapped(unwrap_shell_words(words))
}

/// A few words naming what a command runs, such as `bun dev` or `npm test`, for a short label.
pub fn shorten_command(command: &str) -> String {
    let clean = clean_command(command);
    let mut words = Vec::new();
    for word in split_command_words(&clean) {
        if SEPARATORS.contains(&word.as_str()) || word.starts_with('-') {
            break;
        }
        words.push(word);
        if words.len() == MAX_SHORT_WORDS {
            break;
        }
    }
    if words.is_empty() { clean } else { words.join(" ") }
}

/// Whether a command is a dev server or watcher, which keeps running by design.
pub fn is_long_running_command(command: &str) -> bool {
    let words = split_command_words(&clean_command(command));
    if words.first().is_some_and(|first| LONG_RUNNING_PROGRAMS.contains(&program_name(first).as_str())) {
        return true;
    }
    words.iter().any(|word| {
        let head = word.split(':').next().unwrap_or(word);
        LONG_RUNNING_WORDS.contains(&head) || word == "--watch" || word == "-w"
    })
}

/// The first line of a command, as labels show it.
pub fn first_line(command: &str) -> &str {
    command.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| part.to_string()).collect()
    }

    #[test]
    fn unwraps_posix_shells_run_with_c_or_lc() {
        assert_eq!(unwrap_shell_command("/bin/zsh -lc 'bun dev'"), "bun dev");
        assert_eq!(unwrap_shell_command("bash -c \"npm test -- --watch=false\""), "npm test -- --watch=false");
        assert_eq!(unwrap_shell_command("sh -c ls"), "ls");
        assert_eq!(unwrap_shell_command("/usr/bin/env bash"), "/usr/bin/env bash");
        assert_eq!(unwrap_shell_command("bash script.sh"), "bash script.sh");
    }

    #[test]
    fn unwraps_cmd_and_powershell() {
        assert_eq!(unwrap_shell_command("cmd.exe /c npm run build"), "npm run build");
        assert_eq!(unwrap_shell_command("powershell -NoProfile -Command \"bun dev\""), "bun dev");
        assert_eq!(unwrap_shell_command("pwsh -c npm test"), "npm test");
    }

    #[test]
    fn unwraps_command_arrays_and_nested_wrappers() {
        assert_eq!(unwrap_shell_words(&words(&["/bin/zsh", "-lc", "cd /work/app && bun dev"])), "cd /work/app && bun dev");
        assert_eq!(unwrap_shell_words(&words(&["git", "status"])), "git status");
        assert_eq!(unwrap_shell_command("bash -lc \"zsh -c 'pnpm dev'\""), "pnpm dev");
    }

    #[test]
    fn drops_version_managers_runners_and_launchers() {
        assert_eq!(clean_command("/bin/zsh -lc 'mise exec node@24.19.0 -- ./node_modules/.bin/vp run dev'"), "vp run dev");
        assert_eq!(clean_command("mise x node@22 -- npm test"), "npm test");
        assert_eq!(clean_command("asdf exec node server.js"), "node server.js");
        assert_eq!(clean_command("nvm exec 20 node server.js"), "node server.js");
        assert_eq!(clean_command("volta run --node 20 npm start"), "npm start");
        assert_eq!(clean_command("fnm exec --using=22 -- bun dev"), "bun dev");
        assert_eq!(clean_command("npx -y vite --port 3000"), "vite --port 3000");
        assert_eq!(clean_command("pnpm dlx serve dist"), "serve dist");
        assert_eq!(clean_command("env PORT=3000 NODE_ENV=dev nice -n 10 nohup time bun dev"), "bun dev");
        assert_eq!(clean_command_words(&words(&["/bin/bash", "-lc", "cd '/work/my app' && /usr/local/bin/node app.js"])), "node app.js");
    }

    #[test]
    fn shortens_a_command_to_what_it_runs() {
        assert_eq!(shorten_command("/bin/zsh -lc 'bun dev --port 5173'"), "bun dev");
        assert_eq!(shorten_command("npm test -- --runInBand"), "npm test");
        assert_eq!(shorten_command("NODE_ENV=test /usr/local/bin/node server.js | tee out.log"), "node server.js");
        assert_eq!(shorten_command("bunx vp test run src/features"), "vp test run");
    }

    #[test]
    fn recognises_dev_servers_and_watchers() {
        assert!(is_long_running_command("mise exec node@24 -- ./node_modules/.bin/vp run dev"));
        assert!(is_long_running_command("npm run dev:web"));
        assert!(is_long_running_command("npx vite"));
        assert!(is_long_running_command("tsc --watch"));
        assert!(!is_long_running_command("bun test"));
        assert!(!is_long_running_command("git status"));
    }
}
