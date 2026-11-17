//! Builds `assets/lsp/servers.json` from the `capabilities.lsp` sections of the extension
//! manifests in the Athas checkout next to this repository:
//! `cargo test -p lsp_client -- --ignored regenerate_servers_json`.

use std::{collections::BTreeMap, path::PathBuf};

use serde_json::Value;

use crate::registry::{LanguageEntry, ServerEntry, ServerTable};

/// The executable when it is not the server's name (`crates/tooling/src/registry.rs` and the
/// packages' `bin` entries).
const COMMANDS: &[(&str, &str)] = &[("pyright", "pyright-langserver"), ("elixir-ls", "language_server.sh")];

fn root_markers(server: &str) -> Vec<String> {
    let markers: &[&str] = match server {
        "rust-analyzer" => &["Cargo.toml", "rust-project.json"],
        "typescript-language-server" | "vue-language-server" | "svelte-language-server" | "astro-ls" => {
            &["package.json", "tsconfig.json", "jsconfig.json"]
        }
        "pyright" => &["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "pyrightconfig.json"],
        "gopls" => &["go.work", "go.mod"],
        "clangd" => &["compile_commands.json", "compile_flags.txt", "CMakeLists.txt", ".clangd"],
        "zls" => &["build.zig"],
        "lua-language-server" => &[".luarc.json"],
        _ => &["package.json"],
    };
    markers.iter().map(|marker| marker.to_string()).collect()
}

#[test]
#[ignore = "rewrites assets/lsp/servers.json from the Athas checkout"]
fn regenerate_servers_json() {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let extensions = manifest_dir.join("../../extensions/official");
    let mut folders: Vec<PathBuf> = std::fs::read_dir(&extensions).expect("extensions/official exists").flatten().map(|entry| entry.path()).collect();
    folders.sort();
    let mut table = ServerTable { languages: Vec::new(), servers: BTreeMap::new() };
    for folder in folders {
        let Ok(text) = std::fs::read_to_string(folder.join("extension.json")) else { continue };
        let manifest: Value = serde_json::from_str(&text).expect("a valid manifest");
        let Some(lsp) = manifest.pointer("/capabilities/lsp") else { continue };
        let Some(name) = lsp.get("name").and_then(Value::as_str) else { continue };
        let strings = |value: Option<&Value>| -> Vec<String> {
            value.and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default()
        };
        let command = COMMANDS.iter().find(|(server, _)| *server == name).map(|(_, command)| command.to_string()).unwrap_or_else(|| name.to_string());
        table.servers.entry(name.to_string()).or_insert_with(|| ServerEntry {
            runtime: lsp.get("runtime").and_then(Value::as_str).unwrap_or("binary").to_string(),
            command,
            package: lsp.get("package").and_then(Value::as_str).map(str::to_string),
            args: strings(lsp.get("args")),
            initialization_options: lsp.get("initializationOptions").cloned(),
            root_markers: root_markers(name),
        });
        for language in manifest.get("languages").and_then(Value::as_array).into_iter().flatten() {
            let Some(id) = language.get("id").and_then(Value::as_str) else { continue };
            if table.languages.iter().any(|entry| entry.id == id) {
                continue;
            }
            table.languages.push(LanguageEntry {
                id: id.to_string(),
                extensions: strings(language.get("extensions")).iter().map(|extension| extension.trim_start_matches('.').to_ascii_lowercase()).collect(),
                filenames: strings(language.get("filenames")),
                server: name.to_string(),
            });
        }
    }
    let json = serde_json::to_string_pretty(&table).unwrap();
    std::fs::write(manifest_dir.join("../../assets/lsp/servers.json"), json + "\n").unwrap();
}
