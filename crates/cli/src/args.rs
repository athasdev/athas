//! What `athas …` asks for, ported from the Tauri app's `cli_args.rs`: paths with `:line:column`,
//! `--wait`, new or reused windows, terminals, settings, GitHub resources, remotes and web pages.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const HELP_TEXT: &str = r#"Athas CLI

Usage:
  athas [--new-window | --reuse-window] [paths...]
  athas open [--new-window | --reuse-window] <paths...>
  athas --wait <files...>
  athas window
  athas terminal [--cwd <directory>] [--reuse-window] [--] [command...]
  athas settings
  athas extensions
  athas pr <number> [--cwd <repository>]
  athas issue <number> [--cwd <repository>]
  athas action <run-id> [--cwd <repository>]
  athas remote [--new-window] <connection-id> [name]
  athas web <url>

Options:
  -n, --new-window     Open each target in a new window
  -r, --reuse-window   Open in an existing editor (create one if needed)
  -w, --wait           Return only after the files are closed (EDITOR="athas --wait")
  --cwd <directory>   Working directory for terminals and repository commands
  --                  End Athas options; following arguments belong to the command
  -h, --help          Show this help
  -v, --version       Print the version

Paths take an optional :line or :line:column suffix, such as src/main.rs:120:4.
Pass shell expressions as one quoted command string.

Examples:
  athas .
  athas terminal -- bun test
  athas --new-window src/main.rs:120
  git config --global core.editor "athas --wait"
  athas pr 42 --cwd ~/projects/my-app
"#;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CliRequest {
    NewWindow {
        request: Box<CliRequest>,
    },
    /// A view that is not a file: `settings`, `extensions`, `pr`, `issue` or `action`.
    Surface {
        name: String,
        working_directory: String,
        resource_id: Option<u64>,
    },
    Empty,
    Path {
        path: String,
        is_directory: bool,
        line: Option<u32>,
        column: Option<u32>,
        /// The file `athas --wait` watches; Athas deletes it once the files it opened are closed.
        wait_marker: Option<String>,
    },
    Web {
        url: String,
    },
    Terminal {
        command: Option<String>,
        working_directory: Option<String>,
    },
    Remote {
        connection_id: String,
        name: Option<String>,
    },
}

/// Splits `:<positive number>` off the end of `arg`.
fn split_number_suffix(arg: &str) -> Option<(&str, u32)> {
    let (head, tail) = arg.rsplit_once(':')?;
    if tail.is_empty() || !tail.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let number = tail.parse::<u32>().ok().filter(|number| *number > 0)?;
    Some((head, number))
}

/// Splits a path argument into the path, line and column. Handles `file:line` and
/// `file:line:column` while respecting Windows drive letters (`C:\foo`).
pub fn split_path_position(arg: &str) -> (&str, Option<u32>, Option<u32>) {
    let Some((rest, last)) = split_number_suffix(arg) else {
        return (arg, None, None);
    };
    match split_number_suffix(rest) {
        Some((path, line)) => (path, Some(line), Some(last)),
        None => (rest, Some(last), None),
    }
}

/// Resolves a path argument against `cwd`. `None` when the path does not exist.
pub fn parse_open_arg(arg: &str, cwd: &Path) -> Option<CliRequest> {
    let (file_part, line, column) = split_path_position(arg);
    let path = if Path::new(file_part).is_absolute() { PathBuf::from(file_part) } else { cwd.join(file_part) };
    // `dunce` keeps Windows paths in their plain `C:\...` form rather than `\\?\C:\...`.
    let canonical = dunce::canonicalize(&path).ok()?;
    let is_directory = canonical.is_dir();
    Some(CliRequest::Path {
        path: canonical.to_string_lossy().into_owned(),
        is_directory,
        line: if is_directory { None } else { line },
        column: if is_directory { None } else { column },
        wait_marker: None,
    })
}

fn quote_command_arg(arg: &str) -> String {
    if cfg!(windows) { quote_windows_arg(arg) } else { quote_posix_arg(arg) }
}

fn quote_posix_arg(arg: &str) -> String {
    if !arg.is_empty() && arg.chars().all(|c| c.is_ascii_alphanumeric() || "_./:=+-".contains(c)) {
        return arg.to_string();
    }
    format!("'{}'", arg.replace('\'', "'\\''"))
}

/// Quotes for the default Windows shell (cmd) and the programs it starts, which split their
/// command line by the C runtime's rules: backslashes double only before a quote, and a quote
/// inside is `\"`. cmd expands `%` even inside quotes, so it is written as `"^%"` (outside them).
fn quote_windows_arg(arg: &str) -> String {
    if !arg.is_empty() && arg.chars().all(|c| c.is_ascii_alphanumeric() || "_./:=+-\\".contains(c)) {
        return arg.to_string();
    }
    let mut quoted = String::from('"');
    let mut backslashes = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => backslashes += 1,
            '"' => {
                quoted.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            }
            '%' => {
                quoted.extend(std::iter::repeat_n('\\', backslashes));
                quoted.push_str("\"^%\"");
                backslashes = 0;
            }
            _ => {
                quoted.extend(std::iter::repeat_n('\\', backslashes));
                quoted.push(ch);
                backslashes = 0;
            }
        }
    }
    quoted.extend(std::iter::repeat_n('\\', backslashes * 2));
    quoted.push('"');
    quoted
}

fn canonical_string(path: &Path) -> String {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf()).to_string_lossy().into_owned()
}

fn parse_paths(args: &[&str], cwd: &Path) -> Option<Vec<CliRequest>> {
    args.iter().map(|arg| parse_open_arg(arg, cwd)).collect()
}

fn parse_reused_cli_args(args: &[&str], cwd: &Path) -> Option<Vec<CliRequest>> {
    let Some(first) = args.first() else { return Some(Vec::new()) };
    match *first {
        "open" => parse_paths(&args[1..], cwd),
        "web" if args.len() == 2 => Some(vec![CliRequest::Web { url: args[1].to_string() }]),
        "terminal" | "term" => {
            let command = match args.len() {
                1 => None,
                2 => Some(args[1].to_string()),
                _ => Some(args[1..].iter().map(|arg| quote_command_arg(arg)).collect::<Vec<_>>().join(" ")),
            };
            Some(vec![CliRequest::Terminal { command, working_directory: Some(canonical_string(cwd)) }])
        }
        "remote" => {
            let connection_id = args.get(1)?;
            let name = (args.len() > 2).then(|| args[2..].join(" "));
            Some(vec![CliRequest::Remote { connection_id: connection_id.to_string(), name }])
        }
        _ => parse_paths(args, cwd),
    }
}

/// The parsed requests and whether `--wait` asked the CLI to block until the files close.
#[derive(Debug, Default, PartialEq)]
pub struct ParsedCli {
    pub requests: Vec<CliRequest>,
    pub wait: bool,
}

/// Parses the arguments after the program name. `None` when they are not valid: an unknown
/// option, a missing value, a path that does not exist, or `--wait` without files.
pub fn parse_cli(args: &[String], cwd: &Path) -> Option<ParsedCli> {
    let mut args = args.to_vec();
    let mut new_window = None;
    let mut wait = false;
    let mut working_directory = cwd.to_path_buf();
    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--" => {
                args.remove(index);
                break;
            }
            "--wait" | "-w" => {
                wait = true;
                args.remove(index);
            }
            "--new-window" | "-n" => {
                new_window = Some(true);
                args.remove(index);
            }
            "--reuse-window" | "-r" => {
                new_window = Some(false);
                args.remove(index);
            }
            "--cwd" => {
                working_directory = cwd.join(args.get(index + 1)?);
                if !working_directory.is_dir() {
                    return None;
                }
                args.drain(index..=index + 1);
            }
            "terminal" | "term" if index == 0 => index += 1,
            value if value.starts_with('-') => return None,
            _ if index > 0 && matches!(args.first().map(String::as_str), Some("terminal" | "term")) => break,
            _ => index += 1,
        }
    }
    let args = args.iter().map(String::as_str).collect::<Vec<_>>();
    let command = args.first().copied().unwrap_or("");
    let standalone = matches!(command, "terminal" | "term" | "settings" | "extensions" | "pr" | "issue" | "action");
    let requests = match command {
        "help" | "-h" | "--help" => return None,
        "window" if args.len() == 1 => vec![CliRequest::Empty],
        "" if new_window == Some(true) => vec![CliRequest::Empty],
        "settings" | "extensions" | "pr" | "issue" | "action" => {
            let takes_id = matches!(command, "pr" | "issue" | "action");
            if args.len() != if takes_id { 2 } else { 1 } {
                return None;
            }
            let resource_id = if takes_id { Some(args[1].parse::<u64>().ok().filter(|id| *id > 0)?) } else { None };
            vec![CliRequest::Surface {
                name: command.to_string(),
                working_directory: canonical_string(&working_directory),
                resource_id,
            }]
        }
        _ => parse_reused_cli_args(&args, &working_directory)?,
    };
    if wait {
        // Waiting needs files the editor can close: no folders, terminals or new windows.
        let only_files =
            requests.iter().all(|request| matches!(request, CliRequest::Path { is_directory: false, .. }));
        if requests.is_empty() || !only_files {
            return None;
        }
        return Some(ParsedCli { requests, wait });
    }
    let requests = if new_window.unwrap_or(standalone || command == "window") {
        requests.into_iter().map(|request| CliRequest::NewWindow { request: Box::new(request) }).collect()
    } else {
        requests
    };
    Some(ParsedCli { requests, wait })
}

/// Parses a full argv, dropping the executable, as a cold start of the app sees it.
pub fn parse_cli_argv(argv: &[String], cwd: &Path) -> Option<ParsedCli> {
    parse_cli(argv.get(1..).unwrap_or_default(), cwd)
}

/// Marks every file request with the marker `athas --wait` watches.
pub fn with_wait_marker(requests: Vec<CliRequest>, marker: &str) -> Vec<CliRequest> {
    requests
        .into_iter()
        .map(|request| match request {
            CliRequest::Path { path, is_directory, line, column, .. } => {
                CliRequest::Path { path, is_directory, line, column, wait_marker: Some(marker.to_string()) }
            }
            request => request,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| arg.to_string()).collect()
    }

    fn requests(args: &[&str], cwd: &Path) -> Vec<CliRequest> {
        parse_cli(&strings(args), cwd).map(|parsed| parsed.requests).unwrap_or_default()
    }

    fn manifest_dir() -> &'static Path {
        Path::new(env!("CARGO_MANIFEST_DIR"))
    }

    fn canonical(path: &Path) -> String {
        dunce::canonicalize(path).unwrap().to_string_lossy().into_owned()
    }

    #[test]
    fn splits_lines_and_columns() {
        assert_eq!(split_path_position("foo.txt"), ("foo.txt", None, None));
        assert_eq!(split_path_position("foo.txt:42"), ("foo.txt", Some(42), None));
        assert_eq!(split_path_position("src/main.rs:42:7"), ("src/main.rs", Some(42), Some(7)));
        assert_eq!(split_path_position("C:\\src\\main.rs:42:7"), ("C:\\src\\main.rs", Some(42), Some(7)));
        assert_eq!(split_path_position("foo.txt:0:7"), ("foo.txt:0", Some(7), None));
        assert_eq!(split_path_position("foo.txt:0"), ("foo.txt:0", None, None));
        assert_eq!(split_path_position("foo.txt:"), ("foo.txt:", None, None));
        assert_eq!(split_path_position("C:\\Users\\foo\\bar.txt"), ("C:\\Users\\foo\\bar.txt", None, None));
        assert_eq!(split_path_position("C:\\Users\\foo\\bar.txt:10"), ("C:\\Users\\foo\\bar.txt", Some(10), None));
    }

    #[test]
    fn dot_resolves_to_the_working_directory() {
        let request = parse_open_arg(".", manifest_dir()).unwrap();
        assert_eq!(
            request,
            CliRequest::Path {
                path: canonical(manifest_dir()),
                is_directory: true,
                line: None,
                column: None,
                wait_marker: None
            }
        );
    }

    #[test]
    fn files_keep_their_position_and_folders_drop_it() {
        let request = parse_open_arg("Cargo.toml:3:2", manifest_dir()).unwrap();
        assert!(matches!(request, CliRequest::Path { is_directory: false, line: Some(3), column: Some(2), .. }));
        let request = parse_open_arg("src:3", manifest_dir()).unwrap();
        assert!(matches!(request, CliRequest::Path { is_directory: true, line: None, .. }));
        assert!(parse_open_arg("this_file_does_not_exist_xyz_123.txt", manifest_dir()).is_none());
    }

    #[test]
    fn no_arguments_just_bring_athas_forward() {
        assert_eq!(parse_cli(&[], manifest_dir()), Some(ParsedCli::default()));
        assert_eq!(parse_cli(&strings(&["-r"]), manifest_dir()), Some(ParsedCli::default()));
        assert_eq!(requests(&["-n"], manifest_dir()), vec![CliRequest::NewWindow { request: Box::new(CliRequest::Empty) }]);
        assert_eq!(requests(&["window"], manifest_dir()), vec![CliRequest::NewWindow { request: Box::new(CliRequest::Empty) }]);
    }

    #[test]
    fn web_and_remote_commands() {
        assert_eq!(requests(&["web", "https://athas.dev"], manifest_dir()), vec![CliRequest::Web { url: "https://athas.dev".into() }]);
        assert_eq!(
            requests(&["remote", "conn-1", "My", "Server"], manifest_dir()),
            vec![CliRequest::Remote { connection_id: "conn-1".into(), name: Some("My Server".into()) }]
        );
        assert!(parse_cli(&strings(&["remote"]), manifest_dir()).is_none());
    }

    #[test]
    fn terminals_open_in_their_own_window() {
        assert_eq!(
            requests(&["terminal", "npm", "test"], manifest_dir()),
            vec![CliRequest::NewWindow {
                request: Box::new(CliRequest::Terminal {
                    command: Some("npm test".into()),
                    working_directory: Some(canonical(manifest_dir())),
                })
            }]
        );
        assert!(matches!(requests(&["terminal", "-r"], manifest_dir())[0], CliRequest::Terminal { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn windows_arguments_survive_the_c_runtime_split() {
        assert_eq!(quote_windows_arg(r"C:\dir\file.txt"), r"C:\dir\file.txt");
        assert_eq!(quote_windows_arg("a b"), r#""a b""#);
        assert_eq!(quote_windows_arg(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote_windows_arg(r"C:\my dir\"), r#""C:\my dir\\""#);
        assert_eq!(quote_windows_arg(r#"a\"b"#), r#""a\\\"b""#);
        assert_eq!(quote_windows_arg("100%"), r#""100"^%"""#);
        assert_eq!(quote_windows_arg(""), r#""""#);
    }

    #[test]
    fn terminal_options_preserve_command_arguments() {
        let args = ["terminal", "--cwd", ".", "--", "printf", "%s", "two words", "$(echo unsafe)", "--new-window", "--disable-gpu"];
        let requests = requests(&args, Path::new("/"));
        let CliRequest::NewWindow { request } = &requests[0] else { panic!("expected a new window") };
        let CliRequest::Terminal { command, working_directory } = request.as_ref() else { panic!("expected a terminal") };
        assert_eq!(command.as_deref(), Some("printf '%s' 'two words' '$(echo unsafe)' --new-window --disable-gpu"));
        assert_eq!(working_directory.as_deref(), Some("/"));
    }

    #[test]
    fn open_subcommand_and_new_window_flag() {
        let path = CliRequest::Path {
            path: canonical(manifest_dir()),
            is_directory: true,
            line: None,
            column: None,
            wait_marker: None,
        };
        assert_eq!(requests(&["open", "."], manifest_dir()), vec![path.clone()]);
        assert_eq!(requests(&["open", "-n", "."], manifest_dir()), vec![CliRequest::NewWindow { request: Box::new(path) }]);
    }

    #[test]
    fn surfaces_carry_the_repository() {
        let requests = requests(&["issue", "42", "--cwd", "."], manifest_dir());
        let CliRequest::NewWindow { request } = &requests[0] else { panic!("expected a new window") };
        assert_eq!(
            request.as_ref(),
            &CliRequest::Surface { name: "issue".into(), working_directory: canonical(manifest_dir()), resource_id: Some(42) }
        );
    }

    #[test]
    fn wait_needs_files() {
        let parsed = parse_cli(&strings(&["--wait", "Cargo.toml:4"]), manifest_dir()).unwrap();
        assert!(parsed.wait);
        assert!(matches!(parsed.requests[..], [CliRequest::Path { line: Some(4), wait_marker: None, .. }]));
        for args in [vec!["--wait"], vec!["-w", "."], vec!["-w", "terminal"], vec!["-w", "settings"]] {
            assert_eq!(parse_cli(&strings(&args), manifest_dir()), None, "{args:?}");
        }
    }

    #[test]
    fn wait_markers_go_on_files() {
        let marked = with_wait_marker(requests(&["Cargo.toml"], manifest_dir()), "/tmp/athas-cli-wait/1-2");
        assert!(matches!(&marked[0], CliRequest::Path { wait_marker: Some(marker), .. } if marker == "/tmp/athas-cli-wait/1-2"));
    }

    #[test]
    fn argv_drops_the_executable() {
        let argv = strings(&["/Applications/Athas.app/Contents/MacOS/athas", "."]);
        assert!(matches!(parse_cli_argv(&argv, manifest_dir()).unwrap().requests[0], CliRequest::Path { .. }));
        // Finder used to pass a process serial number; it is not an Athas option.
        assert!(parse_cli_argv(&strings(&["athas", "-psn_0_1234"]), manifest_dir()).is_none());
    }

    #[test]
    fn rejects_invalid_options_and_missing_targets() {
        for args in [
            vec!["terminal", "--cwd"],
            vec!["terminal", "--cwd", "/athas-nonexistent-dir-123"],
            vec!["--unknown"],
            vec!["issue", "0"],
            vec!["pr"],
            vec!["settings", "extra"],
            vec!["open", ".", "/athas-nonexistent-dir-123"],
            vec!["help"],
        ] {
            assert!(parse_cli(&strings(&args), manifest_dir()).is_none(), "{args:?}");
        }
    }

    #[test]
    fn requests_round_trip_as_json() {
        let request = CliRequest::NewWindow {
            request: Box::new(CliRequest::Path {
                path: "/a b".into(),
                is_directory: false,
                line: Some(1),
                column: None,
                wait_marker: None,
            }),
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"kind\":\"new_window\""));
        assert_eq!(serde_json::from_str::<CliRequest>(&json).unwrap(), request);
    }
}
