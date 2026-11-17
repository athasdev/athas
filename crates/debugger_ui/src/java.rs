//! Java sessions (`startJavaDebugLaunchSession`): jdtls resolves the main class, class path and
//! Java executable, then starts java-debug and answers with its port.

use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};
use dap::{Adapter, Connection, LaunchConfig, RequestKind};
use gpui::{AsyncApp, Entity};
use lsp_client::LspStore;
use serde_json::{Value, json};

async fn execute(lsp: &Entity<LspStore>, file: &Path, command: &str, arguments: Vec<Value>, cx: &mut AsyncApp) -> Result<Value> {
    let task = lsp.update(cx, |store, cx| store.execute_command(file, command, arguments, cx));
    Ok(task.await?.unwrap_or(Value::Null))
}

fn text(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty()).map(String::from)
}

/// Fills in what a launch needs that the configuration leaves out.
pub(crate) async fn resolve_launch(lsp: &Entity<LspStore>, file: &Path, mut config: LaunchConfig, cx: &mut AsyncApp) -> Result<LaunchConfig> {
    if config.request == RequestKind::Attach {
        return Ok(config);
    }
    let file_text = file.to_string_lossy().into_owned();
    let mut main_class = text(config.arguments.get("mainClass"));
    let mut project_name = text(config.arguments.get("projectName"));
    if main_class.as_deref().is_none_or(|main| main == "${file}" || main == file_text) {
        let uri = lsp_client::uri::from_path(file).map(|uri| uri.to_string()).unwrap_or_default();
        let candidates = execute(lsp, file, "vscode.java.resolveMainMethod", vec![json!(uri)], cx).await?;
        let first = candidates.as_array().and_then(|candidates| candidates.first());
        main_class = text(first.and_then(|first| first.get("mainClass")));
        project_name = text(first.and_then(|first| first.get("projectName"))).or(project_name);
    }
    let main_class = main_class.ok_or_else(|| anyhow!("No Java main method was found in the active file"))?;
    config.arguments.insert("mainClass".into(), main_class.clone().into());
    if let Some(project_name) = &project_name {
        config.arguments.insert("projectName".into(), project_name.clone().into());
    }
    let has_class_paths = config.arguments.get("classPaths").and_then(Value::as_array).is_some_and(|paths| !paths.is_empty());
    if !has_class_paths {
        let paths = execute(lsp, file, "vscode.java.resolveClasspath", vec![json!(main_class), json!(project_name)], cx).await?;
        if let Some([module_paths, class_paths, ..]) = paths.as_array().map(Vec::as_slice) {
            if module_paths.is_array() {
                config.arguments.insert("modulePaths".into(), module_paths.clone());
            }
            if class_paths.is_array() {
                config.arguments.insert("classPaths".into(), class_paths.clone());
            }
        }
    }
    if text(config.arguments.get("javaExec")).is_none() {
        let java = execute(lsp, file, "vscode.java.resolveJavaExecutable", vec![json!(main_class), json!(project_name)], cx).await?;
        if let Some(java) = text(Some(&java)) {
            config.arguments.insert("javaExec".into(), java.into());
        }
    }
    Ok(config)
}

/// Asks jdtls to start java-debug, and connects to the port it answers with.
pub(crate) async fn start_adapter(lsp: &Entity<LspStore>, file: &Path, cx: &mut AsyncApp) -> Result<Adapter> {
    let port = execute(lsp, file, "vscode.java.startDebugSession", Vec::new(), cx).await?;
    let port = port.as_u64().or_else(|| port.as_str().and_then(|port| port.trim().parse().ok()));
    let port = port.and_then(|port| u16::try_from(port).ok()).filter(|port| *port > 0);
    let port = port.ok_or_else(|| anyhow!("Java language server did not return a valid debug adapter port"))?;
    Ok(Adapter { name: "java-debug".into(), kind: "java".into(), connection: Connection::Tcp { host: "127.0.0.1".into(), port, spawn: None } })
}

pub(crate) fn is_java(path: &Path) -> bool {
    path.extension().is_some_and(|extension| extension == "java")
}

pub(crate) fn java_file(active: Option<&PathBuf>) -> Option<PathBuf> {
    active.filter(|path| is_java(path)).cloned()
}
