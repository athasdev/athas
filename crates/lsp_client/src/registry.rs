//! Which language server serves a file, and where its executable is.
//!
//! The table in `assets/lsp/servers.json` is made from the `capabilities.lsp` sections of Athas's
//! extension manifests (`extensions/official/*/extension.json`; run the ignored
//! `regenerate_servers_json` test to refresh it). Executables come from `PATH` (and the usual
//! user tool folders a GUI app does not inherit) or from the tools installed under
//! `~/Library/Application Support/dev.athas.gpui/tools` (the `tooling` crate, from the extension
//! manager) or `com.code.athas*/tools` (the Tauri app). Nothing is ever installed from here.

use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::LazyLock,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ServerTable {
    pub languages: Vec<LanguageEntry>,
    pub servers: BTreeMap<String, ServerEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LanguageEntry {
    /// The LSP language id (`rust`, `typescriptreact`).
    pub id: String,
    /// Extensions without the dot, lowercase.
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    pub server: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    /// How Athas installs it: `binary`, `bun`, `node`, `python`, `go`, `cargo`, `ruby`, …
    pub runtime: String,
    /// The executable (or the package's `bin` entry) to run.
    pub command: String,
    #[serde(default)]
    pub package: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub initialization_options: Option<Value>,
    /// Files that mark a project root for this server.
    #[serde(default)]
    pub root_markers: Vec<String>,
}

static TABLE: LazyLock<ServerTable> =
    LazyLock::new(|| serde_json::from_str(include_str!("../../../assets/lsp/servers.json")).expect("assets/lsp/servers.json is valid"));

pub fn table() -> &'static ServerTable {
    &TABLE
}

/// The language and server for a file, by its name or extension.
pub fn language_for_path(path: &Path) -> Option<&'static LanguageEntry> {
    let file_name = path.file_name()?.to_str()?;
    let extension = path.extension().and_then(|extension| extension.to_str()).map(str::to_ascii_lowercase);
    let table = table();
    table
        .languages
        .iter()
        .find(|language| language.filenames.iter().any(|name| name == file_name))
        .or_else(|| {
            let extension = extension?;
            table.languages.iter().find(|language| language.extensions.contains(&extension))
        })
}

pub fn server(name: &str) -> Option<&'static ServerEntry> {
    table().servers.get(name)
}

/// How to start a server process.
#[derive(Clone, Debug, PartialEq)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Where to look for executables and Athas's installed tools; tests point it at a folder.
#[derive(Clone, Debug)]
pub struct SearchPaths {
    pub path_dirs: Vec<PathBuf>,
    /// `…/com.code.athas*/` folders, each holding `tools/` and `runtimes/`.
    pub athas_data_dirs: Vec<PathBuf>,
}

impl SearchPaths {
    pub fn system() -> Self {
        let mut path_dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
        let home = std::env::var_os("HOME").map(PathBuf::from);
        if let Some(home) = &home {
            // A GUI app starts with a short PATH; these are where user tools usually live.
            for dir in [".cargo/bin", ".bun/bin", "go/bin", ".local/bin", ".local/share/mise/shims", ".volta/bin", ".deno/bin"] {
                path_dirs.push(home.join(dir));
            }
        }
        path_dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
        let mut athas_data_dirs = Vec::new();
        if let Some(data) = data_dir(home.as_deref()) {
            // Tools this app installed (the `tooling` crate), then the old app's release and channels.
            athas_data_dirs.push(data.join(paths::APP_ID));
            athas_data_dirs.push(data.join("com.code.athas"));
            if let Ok(entries) = std::fs::read_dir(&data) {
                let mut others: Vec<PathBuf> = entries
                    .flatten()
                    .filter(|entry| entry.file_name().to_str().is_some_and(|name| name.starts_with("com.code.athas.")))
                    .map(|entry| entry.path())
                    .collect();
                others.sort();
                athas_data_dirs.extend(others);
            }
        }
        athas_data_dirs.retain(|dir| dir.join("tools").is_dir());
        Self { path_dirs, athas_data_dirs }
    }

    fn find_on_path(&self, name: &str) -> Option<PathBuf> {
        let names: Vec<String> = if cfg!(windows) { vec![format!("{name}.exe"), format!("{name}.cmd"), name.to_string()] } else { vec![name.to_string()] };
        self.path_dirs.iter().flat_map(|dir| names.iter().map(move |name| dir.join(name))).find(|path| is_executable(path))
    }

    /// The Java debug adapter Athas installs beside jdtls, which jdtls loads as a bundle.
    pub fn java_debug_bundle(&self) -> Option<PathBuf> {
        self.athas_data_dirs.iter().map(|dir| dir.join("tools/binary/jdtls/java-debug/com.microsoft.java.debug.plugin.jar")).find(|path| path.is_file())
    }

    /// A JavaScript runtime for node-based servers: node first, then bun.
    fn javascript_runtime(&self) -> Option<PathBuf> {
        self.find_on_path("node")
            .or_else(|| self.athas_data_dirs.iter().map(|dir| dir.join("runtimes/node/bin/node")).find(|path| is_executable(path)))
            .or_else(|| self.find_on_path("bun"))
            .or_else(|| self.athas_data_dirs.iter().map(|dir| dir.join("runtimes/bun/bun")).find(|path| is_executable(path)))
    }
}

fn data_dir(home: Option<&Path>) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        home.map(|home| home.join("Library/Application Support"))
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| home.map(|home| home.join(".local/share")))
    }
}

/// `initializationOptions` with `bundle` added to its `bundles` (`buildRuntimeManifest`): the
/// configured bundles first, without repeats.
pub fn with_bundle(options: Option<Value>, bundle: &Path) -> Value {
    let mut options = options.filter(Value::is_object).unwrap_or_else(|| Value::Object(Default::default()));
    let bundle = Value::String(bundle.to_string_lossy().into_owned());
    let mut bundles: Vec<Value> = options.get("bundles").and_then(Value::as_array).map(|list| list.iter().filter(|item| item.is_string()).cloned().collect()).unwrap_or_default();
    if !bundles.contains(&bundle) {
        bundles.push(bundle);
    }
    options["bundles"] = Value::Array(bundles);
    options
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

/// Finds a server's executable. `None` means it is not installed.
pub fn resolve(entry: &ServerEntry, paths: &SearchPaths) -> Option<Launch> {
    let plain = |program: PathBuf| Launch { program, args: entry.args.clone(), env: Vec::new() };
    if let Some(program) = paths.find_on_path(&entry.command) {
        return Some(plain(program));
    }
    for data in &paths.athas_data_dirs {
        let tools = data.join("tools");
        let found = match entry.runtime.as_str() {
            "bun" | "node" => {
                let folder = if entry.runtime == "bun" { "bun" } else { "npm" };
                let package = entry.package.as_deref().map(package_identity).unwrap_or_else(|| entry.command.clone());
                let package_dir = tools.join(folder).join(&package);
                if let Some(script) = node_entrypoint(&package_dir.join("node_modules").join(&package), &entry.command) {
                    let runtime = paths.javascript_runtime()?;
                    let mut args = vec![script.to_string_lossy().into_owned()];
                    args.extend(entry.args.iter().cloned());
                    let node_modules = package_dir.join("node_modules");
                    return Some(Launch { program: runtime, args, env: vec![("NODE_PATH".into(), node_modules.to_string_lossy().into_owned())] });
                }
                Some(package_dir.join("node_modules/.bin").join(&entry.command)).filter(|path| is_executable(path))
            }
            "python" => {
                let package = entry.package.clone().unwrap_or_else(|| entry.command.clone());
                Some(tools.join("python").join(package).join("bin").join(&entry.command)).filter(|path| is_executable(path))
            }
            "go" => Some(tools.join("go/bin").join(&entry.command)).filter(|path| is_executable(path)),
            "cargo" => Some(tools.join("cargo/bin").join(&entry.command)).filter(|path| is_executable(path)),
            "ruby" | "r" => {
                let package = entry.package.clone().unwrap_or_else(|| entry.command.clone());
                let package_dir = tools.join(&entry.runtime).join(package);
                ["bin", "gem-bin"].iter().map(|bin| package_dir.join(bin).join(&entry.command)).find(|path| is_executable(path))
            }
            _ => find_binary(&tools.join("binary").join(&entry.command), &entry.command, 3)
                .or_else(|| Some(tools.join("bin").join(&entry.command)).filter(|path| is_executable(path))),
        };
        if let Some(program) = found {
            return Some(plain(program));
        }
    }
    None
}

/// `@scope/name@1.2` → `@scope/name`, `name@1` → `name` (the folder Athas installs into).
pub fn package_identity(spec: &str) -> String {
    if let Some(scoped) = spec.strip_prefix('@')
        && let Some((scope, rest)) = scoped.split_once('/')
    {
        let name = rest.split_once('@').map(|(name, _)| name).unwrap_or(rest);
        return format!("@{scope}/{name}");
    }
    spec.split_once('@').map(|(name, _)| name).unwrap_or(spec).to_string()
}

/// The script a package's `bin` entry names for `command` (or its only bin).
fn node_entrypoint(package_root: &Path, command: &str) -> Option<PathBuf> {
    let manifest: Value = serde_json::from_str(&std::fs::read_to_string(package_root.join("package.json")).ok()?).ok()?;
    let relative = match manifest.get("bin")? {
        Value::String(single) => single.clone(),
        Value::Object(bins) => bins.get(command).or_else(|| bins.values().next())?.as_str()?.to_string(),
        _ => return None,
    };
    let relative = Path::new(&relative);
    if relative.is_absolute() || relative.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return None;
    }
    Some(package_root.join(relative)).filter(|path| path.is_file())
}

/// An executable called `name` in `dir` or a few levels below (release archives nest a `bin/`).
fn find_binary(dir: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    let direct = dir.join(name);
    if is_executable(&direct) {
        return Some(direct);
    }
    if depth == 0 {
        return None;
    }
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()).collect();
    entries.sort();
    entries.into_iter().find_map(|sub| find_binary(&sub, name, depth - 1))
}

/// The folder a server should treat as the workspace for `file`: the project the workbench gave,
/// else the nearest folder with `.git`, else the outermost folder with one of the server's markers
/// (a Cargo or npm workspace root), else the file's folder.
pub fn root_for(file: &Path, project_root: Option<&Path>, markers: &[String]) -> PathBuf {
    if let Some(root) = project_root
        && file.starts_with(root)
    {
        return root.to_path_buf();
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let parent = file.parent().unwrap_or(file);
    let ancestors = || parent.ancestors().take_while(|dir| home.as_deref() != Some(*dir) && dir.parent().is_some());
    if let Some(git) = ancestors().find(|dir| dir.join(".git").exists()) {
        return git.to_path_buf();
    }
    ancestors().filter(|dir| markers.iter().any(|marker| dir.join(marker).exists())).last().unwrap_or(parent).to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(runtime: &str, command: &str, package: Option<&str>) -> ServerEntry {
        ServerEntry {
            runtime: runtime.into(),
            command: command.into(),
            package: package.map(Into::into),
            args: vec!["--stdio".into()],
            initialization_options: None,
            root_markers: Vec::new(),
        }
    }

    #[test]
    fn java_debug_bundle_joins_the_configured_bundles() {
        let dir = tempfile::tempdir().unwrap();
        let paths = SearchPaths { path_dirs: Vec::new(), athas_data_dirs: vec![dir.path().to_path_buf()] };
        assert_eq!(paths.java_debug_bundle(), None);
        let jar = dir.path().join("tools/binary/jdtls/java-debug/com.microsoft.java.debug.plugin.jar");
        std::fs::create_dir_all(jar.parent().unwrap()).unwrap();
        std::fs::write(&jar, b"jar").unwrap();
        assert_eq!(paths.java_debug_bundle(), Some(jar.clone()));
        let jar_text = jar.to_string_lossy().into_owned();
        assert_eq!(with_bundle(None, &jar), serde_json::json!({ "bundles": [jar_text] }));
        let configured = serde_json::json!({ "settings": {}, "bundles": ["/a.jar", 3, jar_text] });
        assert_eq!(with_bundle(Some(configured), &jar), serde_json::json!({ "settings": {}, "bundles": ["/a.jar", jar_text] }));
    }

    #[cfg(unix)]
    fn executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn the_table_maps_files_to_servers() {
        let rust = language_for_path(Path::new("/a/main.rs")).expect("rust is in the table");
        assert_eq!(rust.id, "rust");
        assert_eq!(server(&rust.server).unwrap().command, "rust-analyzer");
        assert_eq!(language_for_path(Path::new("/a/App.tsx")).unwrap().id, "typescriptreact");
        assert_eq!(language_for_path(Path::new("/a/go.mod")).unwrap().id, "go");
        assert_eq!(server("pyright").unwrap().command, "pyright-langserver");
        assert!(language_for_path(Path::new("/a/notes.unknownext")).is_none());
    }

    #[test]
    fn package_identities() {
        assert_eq!(package_identity("@vue/language-server@2.1"), "@vue/language-server");
        assert_eq!(package_identity("pyright@1.1.400"), "pyright");
        assert_eq!(package_identity("gopls"), "gopls");
    }

    #[cfg(unix)]
    #[test]
    fn finds_path_binaries_then_athas_tools() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("bin");
        let data = dir.path().join("com.code.athas");
        let paths = SearchPaths { path_dirs: vec![bin.clone()], athas_data_dirs: vec![data.clone()] };
        assert_eq!(resolve(&entry("binary", "clangd", None), &paths), None);

        executable(&data.join("tools/binary/clangd/clangd_18/bin/clangd"));
        assert_eq!(resolve(&entry("binary", "clangd", None), &paths).unwrap().program, data.join("tools/binary/clangd/clangd_18/bin/clangd"));
        executable(&bin.join("clangd"));
        assert_eq!(resolve(&entry("binary", "clangd", None), &paths).unwrap().program, bin.join("clangd"));

        executable(&data.join("tools/ruby/solargraph/bin/solargraph"));
        assert_eq!(resolve(&entry("ruby", "solargraph", Some("solargraph")), &paths).unwrap().program, data.join("tools/ruby/solargraph/bin/solargraph"));

        executable(&data.join("tools/go/bin/gopls"));
        assert_eq!(resolve(&entry("go", "gopls", Some("golang.org/x/tools/gopls")), &paths).unwrap().program, data.join("tools/go/bin/gopls"));

        // A package's bin script runs with node.
        let package = data.join("tools/bun/pyright/node_modules/pyright");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("package.json"), r#"{"bin":{"pyright":"index.js","pyright-langserver":"langserver.index.js"}}"#).unwrap();
        std::fs::write(package.join("langserver.index.js"), "").unwrap();
        assert_eq!(resolve(&entry("bun", "pyright-langserver", Some("pyright")), &paths), None, "no JavaScript runtime yet");
        executable(&bin.join("node"));
        let launch = resolve(&entry("bun", "pyright-langserver", Some("pyright")), &paths).unwrap();
        assert_eq!(launch.program, bin.join("node"));
        assert_eq!(launch.args, vec![package.join("langserver.index.js").to_string_lossy().into_owned(), "--stdio".into()]);
    }

    #[test]
    fn roots() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("ws");
        let file = workspace.join("crates/a/src/lib.rs");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(workspace.join("Cargo.toml"), "").unwrap();
        std::fs::write(workspace.join("crates/a/Cargo.toml"), "").unwrap();
        let markers = vec!["Cargo.toml".to_string()];
        assert_eq!(root_for(&file, Some(&workspace.join("crates")), &markers), workspace.join("crates"));
        assert_eq!(root_for(&file, Some(Path::new("/elsewhere")), &markers), workspace);
        std::fs::create_dir_all(workspace.join("crates/a/.git")).unwrap();
        assert_eq!(root_for(&file, None, &markers), workspace.join("crates/a"));
    }
}
