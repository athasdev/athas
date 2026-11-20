//! The language server, formatter and linter of a language extension, as the `tooling` crate
//! installs them (`runtime/language-tool-config.ts` and `language-tool-resolution.ts` in Athas).

use gpui::SharedString;

use crate::manifest::{ExtensionManifest, ToolDescriptor};
#[cfg(not(target_family = "wasm"))]
use crate::manifest::ToolRuntime;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ToolKind {
    Lsp,
    Formatter,
    Linter,
}

impl ToolKind {
    pub const ALL: [ToolKind; 3] = [ToolKind::Lsp, ToolKind::Formatter, ToolKind::Linter];

    pub fn id(self) -> &'static str {
        match self {
            ToolKind::Lsp => "lsp",
            ToolKind::Formatter => "formatter",
            ToolKind::Linter => "linter",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ToolKind::Lsp => "Language server",
            ToolKind::Formatter => "Formatter",
            ToolKind::Linter => "Linter",
        }
    }

    pub fn descriptor(self, manifest: &ExtensionManifest) -> Option<&ToolDescriptor> {
        let capabilities = &manifest.capabilities;
        match self {
            ToolKind::Lsp => capabilities.lsp.as_ref(),
            ToolKind::Formatter => capabilities.formatter.as_ref(),
            ToolKind::Linter => capabilities.linter.as_ref(),
        }
    }
}

/// Where one declared tool stands.
#[derive(Clone, Debug, PartialEq)]
pub enum ToolState {
    /// Not checked yet.
    Unknown,
    NotInstalled,
    /// The fraction downloaded, 0 to 1 (0 while a package manager runs).
    Installing(f32),
    Installed,
    Failed(SharedString),
}

/// The state of each tool a language extension declares; `None` for what it does not declare.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ToolStatuses {
    pub lsp: Option<ToolState>,
    pub formatter: Option<ToolState>,
    pub linter: Option<ToolState>,
}

impl ToolStatuses {
    /// Every declared tool in `state`.
    pub fn declared(manifest: &ExtensionManifest, state: ToolState) -> Self {
        let mut statuses = Self::default();
        for kind in ToolKind::ALL {
            if kind.descriptor(manifest).is_some() {
                statuses.set(kind, state.clone());
            }
        }
        statuses
    }

    pub fn get(&self, kind: ToolKind) -> Option<&ToolState> {
        match kind {
            ToolKind::Lsp => self.lsp.as_ref(),
            ToolKind::Formatter => self.formatter.as_ref(),
            ToolKind::Linter => self.linter.as_ref(),
        }
    }

    pub fn set(&mut self, kind: ToolKind, state: ToolState) {
        let slot = match kind {
            ToolKind::Lsp => &mut self.lsp,
            ToolKind::Formatter => &mut self.formatter,
            ToolKind::Linter => &mut self.linter,
        };
        *slot = Some(state);
    }

    pub fn iter(&self) -> impl Iterator<Item = (ToolKind, &ToolState)> {
        ToolKind::ALL.into_iter().filter_map(|kind| Some((kind, self.get(kind)?)))
    }

    pub fn is_installing(&self) -> bool {
        self.iter().any(|(_, state)| matches!(state, ToolState::Installing(_)))
    }

    /// The first failure, as the extension page shows it.
    pub fn issue(&self) -> Option<(ToolKind, SharedString)> {
        self.iter().find_map(|(kind, state)| match state {
            ToolState::Failed(message) => Some((kind, message.clone())),
            _ => None,
        })
    }

    pub fn missing(&self) -> bool {
        self.iter().any(|(_, state)| matches!(state, ToolState::NotInstalled | ToolState::Failed(_)))
    }
}

/// The tooling crate's configuration for a manifest's tools (`getLanguageToolConfigSet`).
#[cfg(not(target_family = "wasm"))]
pub fn config_set(manifest: &ExtensionManifest) -> Option<tooling::LanguageToolConfigSet> {
    // A tool whose name or package would leave the tools folder is not used: they become paths
    // the installer writes to and removes (`binary/<name>`, `python/<package>`).
    let config = |kind: ToolKind| kind.descriptor(manifest).filter(|tool| safe_tool(tool)).map(tool_config);
    let set = tooling::LanguageToolConfigSet {
        lsp: config(ToolKind::Lsp),
        formatter: config(ToolKind::Formatter),
        linter: config(ToolKind::Linter),
    };
    (set.lsp.is_some() || set.formatter.is_some() || set.linter.is_some()).then_some(set)
}

/// Names and packages that stay one folder (npm's `@scope/name` aside) inside the tools folder.
#[cfg(not(target_family = "wasm"))]
fn safe_tool(tool: &ToolDescriptor) -> bool {
    let component = |text: &str| {
        let text = text.trim();
        !text.is_empty() && text != "." && text != ".." && !text.contains(['/', '\\', ':']) && !text.starts_with('~')
    };
    let package = |text: &str| match text.trim().strip_prefix('@').and_then(|scoped| scoped.split_once('/')) {
        Some((scope, name)) => component(scope) && component(name.split('@').next().unwrap_or(name)),
        None => component(text.split(['@', '=', '<', '>', '~', '!', '[']).next().unwrap_or(text)),
    };
    component(&tool.name) && tool.package.as_deref().is_none_or(package) && tool.packages.iter().all(|item| package(item))
}

#[cfg(not(target_family = "wasm"))]
fn tool_config(tool: &ToolDescriptor) -> tooling::ToolConfig {
    let name = tool.name.trim().to_string();
    tooling::ToolConfig {
        command: (name == "pyright").then(|| "pyright-langserver".to_string()),
        runtime: match tool.runtime {
            ToolRuntime::Bun => tooling::ToolRuntime::Bun,
            ToolRuntime::Node => tooling::ToolRuntime::Node,
            ToolRuntime::Python => tooling::ToolRuntime::Python,
            ToolRuntime::Go => tooling::ToolRuntime::Go,
            ToolRuntime::Rust => tooling::ToolRuntime::Rust,
            ToolRuntime::Ruby => tooling::ToolRuntime::Ruby,
            ToolRuntime::R => tooling::ToolRuntime::R,
            ToolRuntime::System => tooling::ToolRuntime::System,
            ToolRuntime::Binary => tooling::ToolRuntime::Binary,
        },
        package: tool.package.clone(),
        packages: tool.packages.clone(),
        download_url: known_download_url(&name).or_else(|| tool.download_url.clone()),
        args: tool.args.clone(),
        env: tool.env.iter().map(|(key, value)| (key.clone(), value.clone())).collect(),
        name,
    }
}

#[cfg(not(target_family = "wasm"))]
const MARKSMAN_RELEASE_BASE: &str = "https://github.com/artempyanykh/marksman/releases/latest/download";
#[cfg(not(target_family = "wasm"))]
const STYLUA_RELEASE_BASE: &str = "https://github.com/JohnnyMorganz/StyLua/releases/latest/download";
#[cfg(not(target_family = "wasm"))]
const LUA_LANGUAGE_SERVER_VERSION: &str = "3.18.2";
#[cfg(not(target_family = "wasm"))]
const LUA_LANGUAGE_SERVER_RELEASE_BASE: &str = "https://github.com/LuaLS/lua-language-server/releases/download";
#[cfg(not(target_family = "wasm"))]
const ZIG_VERSION: &str = "0.16.0";

/// Release downloads the manifests leave out (`getKnownToolDownloadUrl`).
#[cfg(not(target_family = "wasm"))]
fn known_download_url(name: &str) -> Option<String> {
    let os = std::env::consts::OS;
    let arm = std::env::consts::ARCH == "aarch64";
    let arch = if arm { "arm64" } else { "x64" };
    let target_arch = if arm { "aarch64" } else { "x86_64" };
    let musl = cfg!(target_env = "musl");
    match name {
        "marksman" => Some(match os {
            "macos" => format!("{MARKSMAN_RELEASE_BASE}/marksman-macos"),
            "windows" => format!("{MARKSMAN_RELEASE_BASE}/marksman.exe"),
            _ => format!("{MARKSMAN_RELEASE_BASE}/marksman-linux-{arch}"),
        }),
        "lua-language-server" => {
            let (platform, extension) = match os {
                "windows" => ("win32-x64".to_string(), "zip"),
                "macos" => (format!("darwin-{arch}"), "tar.gz"),
                _ => (format!("linux-{arch}"), "tar.gz"),
            };
            Some(format!(
                "{LUA_LANGUAGE_SERVER_RELEASE_BASE}/{LUA_LANGUAGE_SERVER_VERSION}/lua-language-server-{LUA_LANGUAGE_SERVER_VERSION}-{platform}.{extension}"
            ))
        }
        "stylua" => Some(match os {
            "macos" => format!("{STYLUA_RELEASE_BASE}/stylua-macos-{target_arch}.zip"),
            "windows" => format!("{STYLUA_RELEASE_BASE}/stylua-windows-x86_64.zip"),
            _ => {
                let suffix = if musl && !arm { "-musl" } else { "" };
                format!("{STYLUA_RELEASE_BASE}/stylua-linux-{target_arch}{suffix}.zip")
            }
        }),
        "zig" => {
            let (platform, extension) = match os {
                "macos" => ("macos", "tar.xz"),
                "windows" => ("windows", "zip"),
                _ => ("linux", "tar.xz"),
            };
            Some(format!("https://ziglang.org/download/{ZIG_VERSION}/zig-{target_arch}-{platform}-{ZIG_VERSION}.{extension}"))
        }
        _ => None,
    }
}

/// What the tooling crate reported, as a state.
#[cfg(not(target_family = "wasm"))]
pub(crate) fn state_of(status: &tooling::ToolStatus) -> ToolState {
    match status {
        tooling::ToolStatus::NotInstalled => ToolState::NotInstalled,
        tooling::ToolStatus::Installed => ToolState::Installed,
        tooling::ToolStatus::Installing => ToolState::Installing(0.),
        tooling::ToolStatus::Failed(message) => ToolState::Failed(message.clone().into()),
    }
}

#[cfg(not(target_family = "wasm"))]
pub(crate) fn statuses_of(status: &tooling::LanguageToolStatus) -> ToolStatuses {
    ToolStatuses {
        lsp: status.lsp.as_ref().map(state_of),
        formatter: status.formatter.as_ref().map(state_of),
        linter: status.linter.as_ref().map(state_of),
    }
}

#[cfg(all(test, not(target_family = "wasm")))]
mod tests {
    use super::*;
    use crate::catalog::Catalog;

    fn manifest(id: &str) -> std::sync::Arc<ExtensionManifest> {
        Catalog::bundled().get(id).unwrap().manifest.clone()
    }

    #[test]
    fn converts_manifest_tools() {
        let python = config_set(&manifest("athas.python")).unwrap();
        let lsp = python.lsp.unwrap();
        assert_eq!(lsp.name, "pyright");
        assert_eq!(lsp.command.as_deref(), Some("pyright-langserver"));

        let rust = config_set(&manifest("athas.rust")).unwrap();
        assert_eq!(rust.lsp.unwrap().name, "rust-analyzer");

        let markdown = config_set(&manifest("athas.markdown")).unwrap();
        assert!(markdown.lsp.unwrap().download_url.unwrap().contains("marksman"));

        assert!(config_set(&manifest("athas.mcp.github")).is_none());
    }

    #[test]
    fn statuses_track_declared_tools() {
        let typescript = manifest("athas.typescript");
        let mut statuses = ToolStatuses::declared(&typescript, ToolState::NotInstalled);
        assert!(statuses.lsp.is_some() && statuses.formatter.is_some() && statuses.linter.is_some());
        assert!(statuses.missing());
        statuses.set(ToolKind::Lsp, ToolState::Installing(0.5));
        assert!(statuses.is_installing());
        statuses.set(ToolKind::Formatter, ToolState::Failed("HTTP 404".into()));
        assert_eq!(statuses.issue(), Some((ToolKind::Formatter, "HTTP 404".into())));
    }
}
