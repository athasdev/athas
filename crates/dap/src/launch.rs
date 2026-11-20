//! Launch configurations: `.vscode/launch.json` (JSON with comments and trailing commas), the
//! `${…}` variables VS Code fills in, and the configurations Athas offers for the open file when a
//! project has none.

use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RequestKind {
    #[default]
    Launch,
    Attach,
}

impl RequestKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RequestKind::Launch => "launch",
            RequestKind::Attach => "attach",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ConfigSource {
    /// From the project's `.vscode/launch.json`.
    #[default]
    Workspace,
    /// Made by Athas for the open file or the project's manifest.
    Generated,
}

/// One entry of `configurations`. Every field of the entry is kept in `arguments`, which is what
/// the `launch` or `attach` request sends, so adapter-specific fields pass through untouched.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LaunchConfig {
    pub name: String,
    /// The adapter type: `debugpy`, `go`, `lldb`, `pwa-node`, …
    pub kind: String,
    pub request: RequestKind,
    pub arguments: Map<String, Value>,
    pub source: ConfigSource,
}

/// Fields Athas reads itself and does not pass to the adapter.
const ATHAS_FIELDS: &[&str] = &["adapterCommand", "adapterArgs", "debugServer", "osx", "linux", "windows", "preLaunchTask", "postDebugTask"];

impl LaunchConfig {
    pub fn string(&self, field: &str) -> Option<&str> {
        self.arguments.get(field).and_then(Value::as_str).filter(|value| !value.trim().is_empty())
    }

    pub fn program(&self) -> Option<&str> {
        self.string("program")
    }

    pub fn cwd(&self) -> Option<&str> {
        self.string("cwd")
    }

    /// Athas's own escape hatch: the adapter to start, for types it does not know.
    pub fn adapter_command(&self) -> Option<(String, Vec<String>)> {
        let command = self.string("adapterCommand")?.to_string();
        let args = self
            .arguments
            .get("adapterArgs")
            .and_then(Value::as_array)
            .map(|args| args.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default();
        Some((command, args))
    }

    /// VS Code's `debugServer`: an adapter already listening on this local port.
    pub fn debug_server(&self) -> Option<u16> {
        self.arguments.get("debugServer").and_then(Value::as_u64).and_then(|port| u16::try_from(port).ok())
    }

    /// The body of the `launch` or `attach` request.
    pub fn request_arguments(&self) -> Value {
        let mut arguments = self.arguments.clone();
        arguments.retain(|key, _| !ATHAS_FIELDS.contains(&key.as_str()));
        arguments.insert("name".into(), self.name.clone().into());
        arguments.insert("type".into(), self.kind.clone().into());
        arguments.insert("request".into(), self.request.as_str().into());
        Value::Object(arguments)
    }

    /// A line describing what it runs, for the picker.
    pub fn description(&self) -> String {
        let target = self
            .program()
            .or_else(|| self.string("module"))
            .or_else(|| self.string("mainClass"))
            .map(String::from)
            .or_else(|| self.arguments.get("processId").map(|id| format!("process {}", id.as_str().map(String::from).unwrap_or_else(|| id.to_string()))))
            .or_else(|| self.arguments.get("port").map(|port| format!("port {port}")));
        match target {
            Some(target) => format!("{} · {} · {target}", self.kind, self.request.as_str()),
            None => format!("{} · {}", self.kind, self.request.as_str()),
        }
    }
}

/// Removes `//` and `/* */` comments outside strings, then commas that close nothing but a `]` or
/// `}`, which is how VS Code reads its JSON files.
pub fn strip_jsonc(input: &str) -> String {
    let mut without_comments = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            without_comments.push(c);
            match c {
                '\\' => without_comments.extend(chars.next()),
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_string = true;
                without_comments.push(c);
            }
            ('/', Some('/')) => {
                for c in chars.by_ref() {
                    if c == '\n' {
                        without_comments.push('\n');
                        break;
                    }
                }
            }
            ('/', Some('*')) => {
                chars.next();
                let mut previous = ' ';
                for c in chars.by_ref() {
                    if c == '\n' {
                        without_comments.push('\n');
                    }
                    if previous == '*' && c == '/' {
                        break;
                    }
                    previous = c;
                }
            }
            _ => without_comments.push(c),
        }
    }

    let chars: Vec<char> = without_comments.chars().collect();
    let mut output = String::with_capacity(chars.len());
    let mut in_string = false;
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if in_string {
            output.push(c);
            if c == '\\' {
                if let Some(next) = chars.get(index + 1) {
                    output.push(*next);
                }
                index += 1;
            } else if c == '"' {
                in_string = false;
            }
        } else if c == '"' {
            in_string = true;
            output.push(c);
        } else if c == ',' {
            let next = chars[index + 1..].iter().find(|c| !c.is_whitespace());
            if !matches!(next, Some(']' | '}')) {
                output.push(c);
            }
        } else {
            output.push(c);
        }
        index += 1;
    }
    output
}

/// Reads `launch.json`. Entries without a name or type are skipped; an OS block (`osx`, `linux`,
/// `windows`) is merged over its entry on that OS.
pub fn parse_launch_json(content: &str) -> Result<Vec<LaunchConfig>> {
    let root: Value = serde_json::from_str(&strip_jsonc(content)).context("launch.json is not valid JSON")?;
    let configurations = root.get("configurations").and_then(Value::as_array).cloned().unwrap_or_default();
    let os_key = if cfg!(target_os = "macos") {
        "osx"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    Ok(configurations
        .into_iter()
        .filter_map(|entry| {
            let Value::Object(mut arguments) = entry else { return None };
            if let Some(Value::Object(overrides)) = arguments.get(os_key).cloned() {
                arguments.extend(overrides);
            }
            let name = arguments.get("name")?.as_str()?.trim().to_string();
            let kind = arguments.get("type")?.as_str()?.trim().to_string();
            if name.is_empty() || kind.is_empty() {
                return None;
            }
            let request = match arguments.get("request").and_then(Value::as_str) {
                Some("attach") => RequestKind::Attach,
                _ => RequestKind::Launch,
            };
            Some(LaunchConfig { name, kind, request, arguments, source: ConfigSource::Workspace })
        })
        .collect())
}

/// The project's `.vscode/launch.json`; no file is no configurations.
pub fn load_workspace_configs(root: &Path) -> Result<Vec<LaunchConfig>> {
    let path = root.join(".vscode").join("launch.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => parse_launch_json(&content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error).with_context(|| format!("reading {}", path.display())),
    }
}

/// What the `${…}` variables stand for.
#[derive(Clone, Debug, Default)]
pub struct Substitutions {
    pub workspace_folder: PathBuf,
    /// The file open in the editor.
    pub file: Option<PathBuf>,
    /// The editor's cursor line, one-based.
    pub line_number: Option<u32>,
    pub selected_text: Option<String>,
}

impl Substitutions {
    pub fn new(workspace_folder: impl Into<PathBuf>) -> Self {
        Self { workspace_folder: workspace_folder.into(), ..Default::default() }
    }

    fn value(&self, name: &str) -> Option<String> {
        let display = |path: &Path| path.to_string_lossy().into_owned();
        let file = self.file.as_deref();
        Some(match name {
            "workspaceFolder" | "workspaceRoot" => display(&self.workspace_folder),
            "workspaceFolderBasename" => self.workspace_folder.file_name().map(|name| name.to_string_lossy().into_owned())?,
            "file" => display(file?),
            "fileBasename" => file?.file_name()?.to_string_lossy().into_owned(),
            "fileBasenameNoExtension" => file?.file_stem()?.to_string_lossy().into_owned(),
            "fileExtname" => file?.extension().map(|extension| format!(".{}", extension.to_string_lossy())).unwrap_or_default(),
            "fileDirname" => display(file?.parent()?),
            "fileDirnameBasename" => file?.parent()?.file_name()?.to_string_lossy().into_owned(),
            "fileWorkspaceFolder" => display(&self.workspace_folder),
            "relativeFile" => display(file?.strip_prefix(&self.workspace_folder).unwrap_or(file?)),
            "relativeFileDirname" => display(file?.parent()?.strip_prefix(&self.workspace_folder).unwrap_or(file?.parent()?)),
            "lineNumber" => self.line_number?.to_string(),
            "selectedText" => self.selected_text.clone()?,
            "cwd" => display(&self.workspace_folder),
            "pathSeparator" | "/" => std::path::MAIN_SEPARATOR.to_string(),
            "userHome" => display(&dirs::home_dir()?),
            "execPath" => std::env::current_exe().ok().map(|path| display(&path))?,
            _ => {
                let variable = name.strip_prefix("env:")?;
                std::env::var(variable).unwrap_or_default()
            }
        })
    }

    /// Fills in every variable it knows; unknown ones (`${input:…}`, `${command:…}`) stay as they
    /// are, so the adapter's error names them.
    pub fn apply(&self, text: &str) -> String {
        let mut output = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(start) = rest.find("${") {
            output.push_str(&rest[..start]);
            let after = &rest[start + 2..];
            let Some(end) = after.find('}') else {
                output.push_str(&rest[start..]);
                return output;
            };
            let name = &after[..end];
            match self.value(name) {
                Some(value) => output.push_str(&value),
                None => output.push_str(&rest[start..start + 2 + end + 1]),
            }
            rest = &after[end + 1..];
        }
        output.push_str(rest);
        output
    }

    pub fn apply_value(&self, value: &Value) -> Value {
        match value {
            Value::String(text) => Value::String(self.apply(text)),
            Value::Array(items) => Value::Array(items.iter().map(|item| self.apply_value(item)).collect()),
            Value::Object(map) => Value::Object(map.iter().map(|(key, value)| (key.clone(), self.apply_value(value))).collect()),
            other => other.clone(),
        }
    }

    pub fn apply_config(&self, config: &LaunchConfig) -> LaunchConfig {
        let Value::Object(arguments) = self.apply_value(&Value::Object(config.arguments.clone())) else { unreachable!() };
        LaunchConfig { name: self.apply(&config.name), arguments, ..config.clone() }
    }
}

/// Configurations for a project without a `launch.json`: one for the open file when its language
/// has a known adapter, and one for a Cargo package's binary.
pub fn generated_configs(root: &Path, file: Option<&Path>) -> Vec<LaunchConfig> {
    let mut configs = Vec::new();
    let generated = |name: String, kind: &str, fields: Value| {
        let Value::Object(mut arguments) = fields else { unreachable!() };
        arguments.insert("name".into(), name.clone().into());
        arguments.insert("type".into(), kind.into());
        arguments.insert("request".into(), "launch".into());
        LaunchConfig { name, kind: kind.into(), request: RequestKind::Launch, arguments, source: ConfigSource::Generated }
    };
    if let Some(file) = file {
        let name = file.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        let extension = file.extension().and_then(|extension| extension.to_str()).unwrap_or_default();
        let program = file.to_string_lossy().into_owned();
        let cwd = root.to_string_lossy().into_owned();
        match extension {
            "py" => configs.push(generated(
                format!("Python: {name}"),
                "debugpy",
                serde_json::json!({ "program": program, "cwd": cwd, "console": "internalConsole", "justMyCode": true }),
            )),
            "go" => configs.push(generated(
                format!("Go: {}", file.parent().and_then(Path::file_name).map(|name| name.to_string_lossy().into_owned()).unwrap_or(name)),
                "go",
                serde_json::json!({ "mode": "debug", "program": file.parent().unwrap_or(root).to_string_lossy(), "cwd": cwd }),
            )),
            "js" | "mjs" | "cjs" | "ts" | "mts" | "cts" => configs.push(generated(
                format!("Node: {name}"),
                "pwa-node",
                serde_json::json!({ "program": program, "cwd": cwd, "console": "internalConsole" }),
            )),
            "java" => configs.push(generated(format!("Java: {name}"), "java", serde_json::json!({ "mainClass": program, "cwd": cwd }))),
            _ => {}
        }
    }
    if let Some(package) = cargo_package_name(root) {
        configs.push(generated(
            format!("Rust: {package}"),
            "lldb-dap",
            serde_json::json!({
                "program": root.join("target").join("debug").join(&package).to_string_lossy(),
                "cwd": root.to_string_lossy(),
                "args": [],
            }),
        ));
    }
    configs
}

fn cargo_package_name(root: &Path) -> Option<String> {
    let manifest = std::fs::read_to_string(root.join("Cargo.toml")).ok()?;
    let package = manifest.split("[package]").nth(1)?.split("\n[").next()?;
    package.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        (key.trim() == "name").then(|| value.trim().trim_matches('"').to_string())
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const LAUNCH: &str = r#"{
        // Use IntelliSense to learn about possible attributes.
        "version": "0.2.0",
        /* Block comment
           over lines */
        "configurations": [
            {
                "name": "Python: Current File",
                "type": "debugpy",
                "request": "launch",
                "program": "${file}", // trailing comment
                "args": ["--url", "http://localhost:8080/a//b", "/* not a comment */"],
                "env": { "ROOT": "${workspaceFolder}", "HOME_DIR": "${env:ATHAS_DAP_TEST_HOME}" },
            },
            {
                "name": "Attach to dlv",
                "type": "go",
                "request": "attach",
                "mode": "remote",
                "debugServer": 4711,
                "osx": { "mode": "local" },
            },
            { "type": "missing-name" },
        ],
    }"#;

    #[test]
    fn strips_comments_and_trailing_commas_outside_strings() {
        let stripped = strip_jsonc(r#"{"a": "x // y", /* c */ "b": [1, 2,], "c": "\"/*", } // end"#);
        let value: Value = serde_json::from_str(&stripped).unwrap();
        assert_eq!(value, json!({ "a": "x // y", "b": [1, 2], "c": "\"/*" }));
        assert_eq!(strip_jsonc("{\n// a\n}").lines().count(), 3);
    }

    #[test]
    fn parses_launch_json() {
        let configs = parse_launch_json(LAUNCH).unwrap();
        assert_eq!(configs.len(), 2);
        assert_eq!(configs[0].name, "Python: Current File");
        assert_eq!(configs[0].kind, "debugpy");
        assert_eq!(configs[0].request, RequestKind::Launch);
        assert_eq!(configs[0].arguments["args"][1], "http://localhost:8080/a//b");
        assert_eq!(configs[0].arguments["args"][2], "/* not a comment */");
        assert_eq!(configs[1].request, RequestKind::Attach);
        assert_eq!(configs[1].debug_server(), Some(4711));
        if cfg!(target_os = "macos") {
            assert_eq!(configs[1].string("mode"), Some("local"));
        }
        let arguments = configs[1].request_arguments();
        assert!(arguments.get("debugServer").is_none());
        assert!(arguments.get("osx").is_none());
        assert_eq!(arguments["request"], "attach");
    }

    #[test]
    fn substitutes_variables() {
        // SAFETY: tests in this module are the only readers of this variable.
        unsafe { std::env::set_var("ATHAS_DAP_TEST_HOME", "/home/test") };
        let mut substitutions = Substitutions::new("/work/app");
        substitutions.file = Some(PathBuf::from("/work/app/src/main.py"));
        substitutions.line_number = Some(7);
        let configs = parse_launch_json(LAUNCH).unwrap();
        let config = substitutions.apply_config(&configs[0]);
        assert_eq!(config.program(), Some("/work/app/src/main.py"));
        assert_eq!(config.arguments["env"]["ROOT"], "/work/app");
        assert_eq!(config.arguments["env"]["HOME_DIR"], "/home/test");
        assert_eq!(substitutions.apply("${relativeFile}:${lineNumber}"), "src/main.py:7");
        assert_eq!(substitutions.apply("${fileBasenameNoExtension}${fileExtname}"), "main.py");
        assert_eq!(substitutions.apply("${fileDirname}|${workspaceFolderBasename}"), "/work/app/src|app");
        assert_eq!(substitutions.apply("${input:pick} ${unclosed"), "${input:pick} ${unclosed");
        assert_eq!(substitutions.apply("${env:ATHAS_DAP_TEST_UNSET_VARIABLE}x"), "x");
    }

    #[test]
    fn unknown_file_variables_stay_without_a_file() {
        assert_eq!(Substitutions::new("/w").apply("${file}"), "${file}");
    }

    #[test]
    fn generates_configs_for_the_open_file_and_cargo() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n[dependencies]\nname = \"x\"\n").unwrap();
        let file = dir.path().join("tool.py");
        let configs = generated_configs(dir.path(), Some(&file));
        assert_eq!(configs.iter().map(|config| config.kind.as_str()).collect::<Vec<_>>(), vec!["debugpy", "lldb-dap"]);
        assert_eq!(configs[0].program(), Some(file.to_string_lossy().as_ref()));
        assert!(configs[1].program().unwrap().ends_with("target/debug/demo"));
        assert!(configs.iter().all(|config| config.source == ConfigSource::Generated));
    }

    #[test]
    fn loads_nothing_without_launch_json() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_workspace_configs(dir.path()).unwrap().is_empty());
        std::fs::create_dir(dir.path().join(".vscode")).unwrap();
        std::fs::write(dir.path().join(".vscode/launch.json"), "{ \"configurations\": [ { \"name\": \"x\", \"type\": \"go\", }, ] }").unwrap();
        assert_eq!(load_workspace_configs(dir.path()).unwrap().len(), 1);
    }
}
