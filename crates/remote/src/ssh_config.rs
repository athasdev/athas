//! `~/.ssh/config`: the options that apply to a host, and the hosts it names for the connections
//! list. Ported from Athas's `ssh_helpers.rs`, with `ProxyJump`, every `IdentityFile`, `Include`
//! (relative to `~/.ssh`, with wildcards) and the `Match` criteria that need no command or network
//! (`all`, `host`, `originalhost`, `user`, `localuser`); other criteria never match, as the
//! original never applied any `Match` block.

use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HostConfig {
    pub hostname: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    /// Every `IdentityFile` that applies, in order, with `~` expanded.
    pub identity_files: Vec<PathBuf>,
    /// `ProxyJump`, as written (`user@jump:2222,other`); `none` clears it.
    pub proxy_jump: Option<String>,
}

/// OpenSSH's limit on nested `Include`s.
const MAX_INCLUDE_DEPTH: usize = 16;

pub fn config_path() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".ssh").join("config"))
}

/// The options for `host` from the user's config; empty when there is none.
pub fn resolve(host: &str) -> HostConfig {
    let Some(home) = dirs::home_dir() else { return HostConfig::default() };
    match std::fs::read_to_string(home.join(".ssh").join("config")) {
        Ok(content) => parse(&content, host, &home),
        Err(_) => HostConfig::default(),
    }
}

/// The concrete host aliases the user's config names (no wildcards), for the connections list.
pub fn configured_hosts() -> Vec<String> {
    let Some(home) = dirs::home_dir() else { return Vec::new() };
    std::fs::read_to_string(home.join(".ssh").join("config")).map(|content| hosts_in(&content, &home)).unwrap_or_default()
}

/// The concrete host aliases of `content` alone.
pub fn hosts(content: &str) -> Vec<String> {
    let mut found = Vec::new();
    collect_hosts(content, None, 0, &mut found);
    found
}

/// The concrete host aliases of `content` and the files it includes.
pub fn hosts_in(content: &str, home: &Path) -> Vec<String> {
    let mut found = Vec::new();
    collect_hosts(content, Some(home), 0, &mut found);
    found
}

fn collect_hosts(content: &str, home: Option<&Path>, depth: usize, found: &mut Vec<String>) {
    for line in content.lines() {
        let Some((key, value)) = split_line(line.trim()) else { continue };
        match key.as_str() {
            "host" => {
                for pattern in value.split_whitespace() {
                    if !pattern.contains(['*', '?', '!']) && !found.iter().any(|host| host == pattern) {
                        found.push(pattern.to_string());
                    }
                }
            }
            "include" if depth < MAX_INCLUDE_DEPTH => {
                if let Some(home) = home {
                    for file in include_files(value, home) {
                        if let Ok(included) = std::fs::read_to_string(&file) {
                            collect_hosts(&included, Some(home), depth + 1, found);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// The files an `Include` line names: each word, `~` expanded, relative to `~/.ssh`, with `*` and
/// `?` in its file name matched against that folder, sorted as OpenSSH's glob does.
pub(crate) fn include_files(value: &str, home: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for word in value.split_whitespace() {
        let path = expand_home(word, home);
        let path = if path.is_absolute() { path } else { home.join(".ssh").join(path) };
        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        if !name.contains(['*', '?']) {
            files.push(path);
            continue;
        }
        let Some(folder) = path.parent() else { continue };
        let Ok(entries) = std::fs::read_dir(folder) else { continue };
        let mut matched: Vec<PathBuf> = entries
            .flatten()
            .filter(|entry| entry.path().is_file() && pattern_matches_exact(&name, &entry.file_name().to_string_lossy()))
            .map(|entry| entry.path())
            .collect();
        matched.sort();
        files.extend(matched);
    }
    files
}

struct Resolving<'a> {
    host: &'a str,
    home: &'a Path,
    config: HostConfig,
    proxy_jump_seen: bool,
}

/// Resolves the options that apply to `host`. As in OpenSSH, the first value for each option wins,
/// so specific `Host` blocks before a trailing `Host *` keep their values.
pub fn parse(content: &str, host: &str, home: &Path) -> HostConfig {
    let mut state = Resolving { host, home, config: HostConfig::default(), proxy_jump_seen: false };
    parse_into(content, &mut state, 0);
    state.config
}

fn parse_into(content: &str, state: &mut Resolving, depth: usize) {
    let mut in_matching_section = true;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = split_line(line) else { continue };
        let (host, config) = (state.host, &mut state.config);
        match key.as_str() {
            "host" => in_matching_section = host_line_matches(value, host),
            "match" => in_matching_section = match_line_matches(value, host, config),
            _ if !in_matching_section => {}
            "include" if depth < MAX_INCLUDE_DEPTH => {
                for file in include_files(value, state.home) {
                    if let Ok(included) = std::fs::read_to_string(&file) {
                        parse_into(&included, state, depth + 1);
                    }
                }
            }
            "hostname" => {
                config.hostname.get_or_insert_with(|| value.replace("%h", host));
            }
            "user" => {
                config.user.get_or_insert_with(|| value.to_string());
            }
            "port" if config.port.is_none() => config.port = value.parse().ok(),
            "identityfile" => {
                let path = expand_home(value, state.home);
                if !config.identity_files.contains(&path) {
                    config.identity_files.push(path);
                }
            }
            "proxyjump" if !state.proxy_jump_seen => {
                state.proxy_jump_seen = true;
                config.proxy_jump = (!value.eq_ignore_ascii_case("none")).then(|| value.to_string());
            }
            _ => {}
        }
    }
}

/// Whether a `Match` line applies: every criterion must hold. `host` is checked against the
/// `HostName` set so far, `originalhost` against what was typed, `user` against the remote user
/// set so far; criteria that need a command, the network or a later pass never match.
fn match_line_matches(value: &str, host: &str, config: &HostConfig) -> bool {
    let words: Vec<&str> = value.split_whitespace().collect();
    let mut index = 0;
    let mut any = false;
    while index < words.len() {
        let word = words[index].to_lowercase();
        let (negated, criterion) = match word.strip_prefix('!') {
            Some(criterion) => (true, criterion.to_string()),
            None => (false, word),
        };
        index += 1;
        let matched = match criterion.as_str() {
            "all" => true,
            "host" | "originalhost" | "user" | "localuser" => {
                let Some(argument) = words.get(index) else { return false };
                index += 1;
                let subject = match criterion.as_str() {
                    "host" => config.hostname.clone().unwrap_or_else(|| host.to_string()),
                    "originalhost" => host.to_string(),
                    "user" => match &config.user {
                        Some(user) => user.clone(),
                        None => return false,
                    },
                    _ => local_user(),
                };
                pattern_list_matches(argument, &subject)
            }
            _ => return false,
        };
        if matched == negated {
            return false;
        }
        any = true;
    }
    any
}

fn local_user() -> String {
    std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default()
}

/// A comma-separated pattern list (`a,b,!c`): any pattern matches and no negated one does.
fn pattern_list_matches(list: &str, value: &str) -> bool {
    let mut matched = false;
    for pattern in list.split(',').filter(|pattern| !pattern.is_empty()) {
        if let Some(negated) = pattern.strip_prefix('!') {
            if pattern_matches(negated, value) {
                return false;
            }
        } else if pattern_matches(pattern, value) {
            matched = true;
        }
    }
    matched
}

fn pattern_matches_exact(pattern: &str, value: &str) -> bool {
    !value.starts_with('.') && pattern_matches(pattern, value)
}

pub fn expand_home(path: &str, home: &Path) -> PathBuf {
    if path == "~" {
        home.to_path_buf()
    } else if let Some(relative) = path.strip_prefix("~/") {
        home.join(relative)
    } else {
        PathBuf::from(path)
    }
}

/// Matches an ssh_config pattern with `*` and `?` wildcards, ignoring case.
pub(crate) fn pattern_matches(pattern: &str, value: &str) -> bool {
    let pattern: Vec<char> = pattern.to_lowercase().chars().collect();
    let value: Vec<char> = value.to_lowercase().chars().collect();
    let (mut p, mut v) = (0, 0);
    let mut backtrack: Option<(usize, usize)> = None;
    while v < value.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == value[v]) {
            p += 1;
            v += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            backtrack = Some((p, v));
            p += 1;
        } else if let Some((star, matched)) = backtrack {
            p = star + 1;
            v = matched + 1;
            backtrack = Some((star, matched + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|character| *character == '*')
}

/// A `Host` line applies when any pattern matches and no negated one does.
fn host_line_matches(patterns: &str, host: &str) -> bool {
    let mut matched = false;
    for pattern in patterns.split_whitespace() {
        if let Some(negated) = pattern.strip_prefix('!') {
            if pattern_matches(negated, host) {
                return false;
            }
        } else if pattern_matches(pattern, host) {
            matched = true;
        }
    }
    matched
}

fn split_line(line: &str) -> Option<(String, &str)> {
    if line.starts_with('#') {
        return None;
    }
    let separator = line.find(|character: char| character == '=' || character.is_whitespace())?;
    let key = line[..separator].to_lowercase();
    let rest = line[separator..].trim_start();
    let value = rest.strip_prefix('=').unwrap_or(rest).trim();
    let value = value.strip_prefix('"').and_then(|inner| inner.strip_suffix('"')).unwrap_or(value);
    (!value.is_empty()).then_some((key, value))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = "\
# global defaults apply to every host
ServerAliveInterval 30

Host dev staging
  HostName 10.0.0.5
  User deploy
  Port 2222
  IdentityFile ~/.ssh/dev_ed25519
  ProxyJump ops@bastion.example.com:2200

Host *.internal !secret.internal
  User ops

Host=equals
  HostName\tequals.example.com
  User = \"quoted user\"
  ProxyJump none

Match host matched
  User from-match

Host *
  User fallback
  Port 22
  IdentityFile ~/.ssh/id_default
  ProxyJump jump
";

    fn resolve(host: &str) -> HostConfig {
        parse(CONFIG, host, Path::new("/home/me"))
    }

    #[test]
    fn first_matching_value_wins_over_trailing_wildcard_block() {
        let config = resolve("staging");
        assert_eq!(config.hostname.as_deref(), Some("10.0.0.5"));
        assert_eq!(config.user.as_deref(), Some("deploy"));
        assert_eq!(config.port, Some(2222));
        assert_eq!(
            config.identity_files,
            vec![PathBuf::from("/home/me/.ssh/dev_ed25519"), PathBuf::from("/home/me/.ssh/id_default")]
        );
        assert_eq!(config.proxy_jump.as_deref(), Some("ops@bastion.example.com:2200"));
    }

    #[test]
    fn matches_wildcards_and_honors_negated_patterns() {
        assert_eq!(resolve("db.internal").user.as_deref(), Some("ops"));
        assert_eq!(resolve("DB.Internal").user.as_deref(), Some("ops"));
        assert_eq!(resolve("secret.internal").user.as_deref(), Some("fallback"));
        let unknown = resolve("example.org");
        assert_eq!(unknown.hostname, None);
        assert_eq!(unknown.port, Some(22));
        assert_eq!(unknown.proxy_jump.as_deref(), Some("jump"));
    }

    #[test]
    fn accepts_equals_tabs_quotes_and_none() {
        let config = resolve("equals");
        assert_eq!(config.hostname.as_deref(), Some("equals.example.com"));
        assert_eq!(config.user.as_deref(), Some("quoted user"));
        assert_eq!(config.proxy_jump, None);
        assert_eq!(resolve("matched").user.as_deref(), Some("from-match"));
    }

    #[test]
    fn invalid_ports_and_empty_configs() {
        assert_eq!(parse("Host box\n  Port nope\n", "box", Path::new("/h")).port, None);
        assert_eq!(parse("", "box", Path::new("/h")), HostConfig::default());
    }

    #[test]
    fn lists_concrete_hosts() {
        assert_eq!(hosts(CONFIG), vec!["dev", "staging", "equals"]);
    }

    #[test]
    fn evaluates_match_criteria() {
        let config = "\
Match originalhost build* user deploy
  Port 2200
Host build1
  HostName 10.1.1.1
  User deploy
Match host 10.1.*
  IdentityFile ~/.ssh/lan
Match !host 10.1.* all
  User outsider
Match exec \"true\"
  User never
Match all
  ProxyJump hop
";
        let home = Path::new("/h");
        let build = parse(config, "build1", home);
        assert_eq!(build.port, None, "user is not known yet when the first Match is read");
        assert_eq!(build.identity_files, vec![PathBuf::from("/h/.ssh/lan")]);
        assert_eq!(build.user.as_deref(), Some("deploy"));
        assert_eq!(build.proxy_jump.as_deref(), Some("hop"));
        let other = parse(config, "web", home);
        assert_eq!(other.user.as_deref(), Some("outsider"));
        assert!(other.identity_files.is_empty());
        assert!(!match_line_matches("host", "x", &HostConfig::default()));
        assert!(!match_line_matches("", "x", &HostConfig::default()));
        assert!(match_line_matches("originalhost a,b,!c", "b", &HostConfig::default()));
        assert!(!match_line_matches("originalhost a,b,!b", "b", &HostConfig::default()));
    }

    #[test]
    fn follows_includes_relative_to_the_ssh_folder() {
        let home = tempfile::tempdir().unwrap();
        let ssh = home.path().join(".ssh");
        std::fs::create_dir_all(ssh.join("config.d")).unwrap();
        std::fs::write(ssh.join("config.d/10-work"), "Host work\n  HostName work.example.com\n  Include deeper\n").unwrap();
        std::fs::write(ssh.join("config.d/20-home"), "Host nas\n  User admin\n").unwrap();
        std::fs::write(ssh.join("config.d/.hidden"), "Host hidden\n").unwrap();
        std::fs::write(ssh.join("deeper"), "Port 2022\n").unwrap();
        std::fs::write(ssh.join("loop"), "Include loop\nHost looped\n").unwrap();
        let config = "Include config.d/*\nInclude ~/.ssh/loop\nHost *\n  User fallback\n";
        let work = parse(config, "work", home.path());
        assert_eq!(work.hostname.as_deref(), Some("work.example.com"));
        assert_eq!(work.port, Some(2022));
        assert_eq!(work.user.as_deref(), Some("fallback"));
        assert_eq!(parse(config, "nas", home.path()).user.as_deref(), Some("admin"));
        assert_eq!(parse(config, "nas", home.path()).port, None);
        assert_eq!(hosts_in(config, home.path()), vec!["work", "nas", "looped"]);
    }

    #[test]
    fn wildcards() {
        assert!(pattern_matches("web-??", "web-01"));
        assert!(!pattern_matches("web-??", "web-1"));
        assert!(pattern_matches("*.a.*.com", "x.a.b.a.c.com"));
        assert!(pattern_matches("*", ""));
        assert!(!pattern_matches("prod*", "staging-prod"));
    }
}
