//! Which debug adapter serves a configuration, found among the tools already installed. Athas
//! never installs an adapter; when none is found the error says what to install.

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use anyhow::{Result, anyhow, bail};
use futures::channel::mpsc::UnboundedReceiver;

use crate::{
    LaunchConfig,
    client::{AdapterCommand, DapClient, Incoming, free_port},
};

/// How long a TCP adapter gets to start listening.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq)]
pub enum Connection {
    /// The adapter speaks DAP on its stdin and stdout.
    Stdio(AdapterCommand),
    /// The adapter listens on a port: one Athas starts (`spawn`), or one already running.
    Tcp { host: String, port: u16, spawn: Option<AdapterCommand> },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Adapter {
    /// Its name in messages: "debugpy", "dlv", "lldb-dap", …
    pub name: String,
    /// The `type` the launch request carries; js-debug wants `pwa-node` where VS Code users write
    /// `node`.
    pub kind: String,
    pub connection: Connection,
}

impl Adapter {
    /// Starts the adapter (when it is ours to start) and connects to it. Blocks while a TCP
    /// adapter comes up, so call it off the main thread.
    pub fn connect(&self) -> Result<(DapClient, UnboundedReceiver<Incoming>)> {
        match &self.connection {
            Connection::Stdio(command) => DapClient::spawn(command),
            Connection::Tcp { host, port, spawn } => DapClient::connect(host, *port, spawn.as_ref(), CONNECT_TIMEOUT),
        }
    }

    pub fn display(&self) -> String {
        match &self.connection {
            Connection::Stdio(command) => command.display(),
            Connection::Tcp { host, port, spawn: Some(command) } => format!("{} ({host}:{port})", command.display()),
            Connection::Tcp { host, port, spawn: None } => format!("{host}:{port}"),
        }
    }
}

/// The adapter for a configuration whose `${…}` variables are already filled in. `cwd` is where
/// the adapter process starts. It may run a quick probe (such as `python3 -c "import debugpy"`),
/// so call it off the main thread.
pub fn resolve(config: &LaunchConfig, cwd: &Path) -> Result<Adapter> {
    let kind = config.kind.as_str();
    let adapter = |name: &str, connection| Adapter { name: name.into(), kind: kind.into(), connection };
    let stdio = |program: PathBuf, args: &[&str]| {
        Connection::Stdio(AdapterCommand {
            program,
            args: args.iter().map(|arg| arg.to_string()).collect(),
            env: Vec::new(),
            cwd: Some(cwd.to_path_buf()),
        })
    };
    let tcp = |program: PathBuf, args: Vec<String>, port: u16| Connection::Tcp {
        host: "127.0.0.1".into(),
        port,
        spawn: Some(AdapterCommand { program, args, env: Vec::new(), cwd: Some(cwd.to_path_buf()) }),
    };

    if let Some(port) = config.debug_server() {
        return Ok(adapter("debug server", Connection::Tcp { host: "127.0.0.1".into(), port, spawn: None }));
    }
    if let Some((command, args)) = config.adapter_command() {
        let program = find_executable(&command).unwrap_or_else(|| PathBuf::from(&command));
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        return Ok(adapter(&command, stdio(program, &args)));
    }

    match kind {
        "debugpy" | "python" => {
            if let Some(program) = find_executable("debugpy-adapter") {
                return Ok(adapter("debugpy", stdio(program, &[])));
            }
            let python = config
                .string("python")
                .map(PathBuf::from)
                .or_else(|| find_executable("python3"))
                .or_else(|| find_executable("python"))
                .ok_or_else(|| anyhow!("Python was not found on PATH. Install Python 3 and `pip install debugpy`."))?;
            let probe = Command::new(&python).args(["-c", "import debugpy"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
            if !probe.is_ok_and(|status| status.success()) {
                bail!("debugpy is not installed for {}. Run `{} -m pip install debugpy`.", python.display(), python.display());
            }
            Ok(adapter("debugpy", stdio(python, &["-m", "debugpy.adapter"])))
        }
        "go" | "delve" => {
            let dlv = find_executable("dlv")
                .ok_or_else(|| anyhow!("Delve was not found. Run `go install github.com/go-delve/delve/cmd/dlv@latest`."))?;
            let port = free_port()?;
            Ok(adapter("dlv", tcp(dlv, vec!["dap".into(), "--listen".into(), format!("127.0.0.1:{port}")], port)))
        }
        "lldb" => match find_codelldb() {
            Some(codelldb) => {
                let port = free_port()?;
                Ok(adapter("codelldb", tcp(codelldb, vec!["--port".into(), port.to_string()], port)))
            }
            None => lldb_dap(cwd).map(|connection| Adapter { name: "lldb-dap".into(), kind: "lldb-dap".into(), connection }),
        },
        "lldb-dap" | "lldb-vscode" | "rust" | "codelldb" => {
            lldb_dap(cwd).map(|connection| Adapter { name: "lldb-dap".into(), kind: kind.into(), connection })
        }
        "gdb" => {
            let gdb = find_executable("gdb").ok_or_else(|| anyhow!("GDB 14 or newer was not found on PATH."))?;
            Ok(adapter("gdb", stdio(gdb, &["--interpreter=dap"])))
        }
        "cppdbg" => {
            let wants_gdb = config.string("MIMode") == Some("gdb");
            match find_executable("gdb").filter(|_| wants_gdb) {
                Some(gdb) => Ok(adapter("gdb", stdio(gdb, &["--interpreter=dap"]))),
                None => lldb_dap(cwd).map(|connection| Adapter { name: "lldb-dap".into(), kind: "lldb-dap".into(), connection }),
            }
        }
        "node" | "pwa-node" | "node-terminal" | "chrome" | "pwa-chrome" | "msedge" | "pwa-msedge" => {
            let kind = match kind {
                "node" | "node-terminal" => "pwa-node",
                "chrome" => "pwa-chrome",
                "msedge" => "pwa-msedge",
                other => other,
            };
            let port = free_port()?;
            let connection = js_debug(port, cwd).ok_or_else(|| {
                anyhow!("js-debug was not found. Put `js-debug-adapter` on PATH, or set ATHAS_JS_DEBUG to its dapDebugServer.js.")
            })?;
            Ok(Adapter { name: "js-debug".into(), kind: kind.into(), connection })
        }
        "java" => bail!("Java debugging starts through the Java language server: open a Java file so jdtls is running."),
        other => bail!("No debug adapter is known for type `{other}`. Set `adapterCommand` (or `debugServer`) in launch.json."),
    }
}

fn lldb_dap(cwd: &Path) -> Result<Connection> {
    let program = find_executable("lldb-dap")
        .or_else(|| find_executable("lldb-vscode"))
        .or_else(xcrun_lldb_dap)
        .ok_or_else(|| anyhow!("lldb-dap was not found. Install the Xcode command line tools or LLVM."))?;
    Ok(Connection::Stdio(AdapterCommand { program, args: Vec::new(), env: Vec::new(), cwd: Some(cwd.to_path_buf()) }))
}

fn xcrun_lldb_dap() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let output = Command::new("/usr/bin/xcrun").args(["--find", "lldb-dap"]).stderr(Stdio::null()).output().ok()?;
    let path = PathBuf::from(String::from_utf8(output.stdout).ok()?.trim());
    (output.status.success() && path.is_file()).then_some(path)
}

fn find_codelldb() -> Option<PathBuf> {
    if let Some(path) = find_executable("codelldb") {
        return Some(path);
    }
    let extensions = dirs::home_dir()?.join(".vscode").join("extensions");
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(extensions)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.file_name().is_some_and(|name| name.to_string_lossy().starts_with("vadimcn.vscode-lldb-")))
        .map(|path| path.join("adapter").join("codelldb"))
        .filter(|path| path.is_file())
        .collect();
    candidates.sort();
    candidates.pop()
}

fn js_debug(port: u16, cwd: &Path) -> Option<Connection> {
    let args = vec![port.to_string(), "127.0.0.1".to_string()];
    let spawn = |program: PathBuf, mut leading: Vec<String>| {
        leading.extend(args.clone());
        Connection::Tcp {
            host: "127.0.0.1".into(),
            port,
            spawn: Some(AdapterCommand { program, args: leading, env: Vec::new(), cwd: Some(cwd.to_path_buf()) }),
        }
    };
    if let Some(program) = find_executable("js-debug-adapter") {
        return Some(spawn(program, Vec::new()));
    }
    let server = std::env::var_os("ATHAS_JS_DEBUG").map(PathBuf::from).filter(|path| path.is_file()).or_else(|| {
        let mason = dirs::home_dir()?.join(".local/share/nvim/mason/packages/js-debug-adapter/js-debug/src/dapDebugServer.js");
        mason.is_file().then_some(mason)
    })?;
    let node = find_executable("node")?;
    Some(spawn(node, vec![server.to_string_lossy().into_owned()]))
}

/// Folders a GUI app's `PATH` often lacks, where toolchains put their binaries.
fn extra_search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> =
        ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/opt/llvm/bin", "/usr/local/opt/llvm/bin"].iter().map(PathBuf::from).collect();
    if let Some(home) = dirs::home_dir() {
        for dir in [".cargo/bin", "go/bin", ".local/bin", ".bun/bin", ".volta/bin"] {
            dirs.push(home.join(dir));
        }
    }
    if let Some(gopath) = std::env::var_os("GOPATH") {
        dirs.push(PathBuf::from(gopath).join("bin"));
    }
    dirs
}

/// `name` on `PATH` or in the usual toolchain folders; an absolute or relative path is taken as is.
pub fn find_executable(name: &str) -> Option<PathBuf> {
    if name.contains(std::path::MAIN_SEPARATOR) {
        let path = PathBuf::from(name);
        return path.is_file().then_some(path);
    }
    let path_dirs = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect::<Vec<_>>()).unwrap_or_default();
    let extensions: &[&str] = if cfg!(windows) { &["exe", "cmd", "bat"] } else { &[""] };
    path_dirs.into_iter().chain(extra_search_dirs()).find_map(|dir| {
        extensions.iter().find_map(|extension| {
            let candidate = if extension.is_empty() { dir.join(name) } else { dir.join(format!("{name}.{extension}")) };
            is_executable(&candidate).then_some(candidate)
        })
    })
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        path.metadata().is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// The adapters found on this machine, by the tool's name, for the empty state.
pub fn installed() -> Vec<(&'static str, PathBuf)> {
    let mut found = Vec::new();
    for (label, binary) in [("dlv", "dlv"), ("lldb-dap", "lldb-dap"), ("codelldb", "codelldb"), ("gdb", "gdb"), ("debugpy", "debugpy-adapter"), ("js-debug", "js-debug-adapter")] {
        if let Some(path) = find_executable(binary) {
            found.push((label, path));
        }
    }
    if !found.iter().any(|(label, _)| *label == "lldb-dap")
        && let Some(path) = xcrun_lldb_dap()
    {
        found.push(("lldb-dap", path));
    }
    found
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::parse_launch_json;

    fn config(fields: serde_json::Value) -> LaunchConfig {
        parse_launch_json(&json!({ "configurations": [fields] }).to_string()).unwrap().remove(0)
    }

    #[test]
    fn debug_server_and_adapter_command_win_over_the_type() {
        let adapter = resolve(&config(json!({ "name": "a", "type": "anything", "debugServer": 4711 })), Path::new("/")).unwrap();
        assert_eq!(adapter.connection, Connection::Tcp { host: "127.0.0.1".into(), port: 4711, spawn: None });

        let adapter =
            resolve(&config(json!({ "name": "a", "type": "mine", "adapterCommand": "sh", "adapterArgs": ["-c", "x"] })), Path::new("/")).unwrap();
        let Connection::Stdio(command) = adapter.connection else { panic!("stdio") };
        assert!(command.program.ends_with("sh"));
        assert_eq!(command.args, vec!["-c", "x"]);
    }

    #[test]
    fn unknown_and_java_types_explain_themselves() {
        let error = resolve(&config(json!({ "name": "a", "type": "cobol" })), Path::new("/")).unwrap_err();
        assert!(error.to_string().contains("adapterCommand"));
        assert!(resolve(&config(json!({ "name": "a", "type": "java" })), Path::new("/")).is_err());
    }

    #[test]
    fn finds_executables_on_path() {
        assert!(find_executable("sh").is_some());
        assert!(find_executable("athas-no-such-adapter").is_none());
    }
}
