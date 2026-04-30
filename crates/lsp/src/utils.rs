use anyhow::{Context, Result};
use athas_runtime::process::configure_background_command;
use std::{
   fs,
   path::{Path, PathBuf},
   process::Command,
};

pub enum PackageManager {
   Bun,
   Node,
}

impl PackageManager {
   pub fn detect() -> Option<Self> {
      if is_command_available("bun") {
         Some(PackageManager::Bun)
      } else if is_command_available("node") {
         Some(PackageManager::Node)
      } else {
         None
      }
   }

   pub fn global_bin_path(&self) -> Result<PathBuf> {
      match self {
         PackageManager::Bun => get_bun_global_bin(),
         PackageManager::Node => get_npm_global_bin(),
      }
   }
}

fn is_command_available(cmd: &str) -> bool {
   let mut command = Command::new("which");
   configure_background_command(&mut command)
      .arg(cmd)
      .output()
      .map(|output| output.status.success())
      .unwrap_or(false)
}

fn get_bun_global_bin() -> Result<PathBuf> {
   let mut command = Command::new("bun");
   let output = configure_background_command(&mut command)
      .args(["pm", "bin", "-g"])
      .output()
      .context("Failed to get bun global bin")?;

   if !output.status.success() {
      anyhow::bail!("bun pm bin -g failed");
   }

   let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
   Ok(PathBuf::from(path))
}

fn get_npm_global_bin() -> Result<PathBuf> {
   let mut command = Command::new("npm");
   let output = configure_background_command(&mut command)
      .args(["bin", "-g"])
      .output()
      .context("Failed to get npm global bin")?;

   if !output.status.success() {
      anyhow::bail!("npm bin -g failed");
   }

   let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
   Ok(PathBuf::from(path))
}

pub fn find_global_binary(binary_name: &str) -> Option<PathBuf> {
   let pm = PackageManager::detect()?;
   let global_bin = pm.global_bin_path().ok()?;
   let binary_path = global_bin.join(binary_name);

   if binary_path.exists() {
      Some(binary_path)
   } else {
      None
   }
}

pub fn find_in_path(binary_name: &str) -> Option<PathBuf> {
   let mut command = Command::new("which");
   let output = configure_background_command(&mut command)
      .arg(binary_name)
      .output()
      .ok()?;

   if output.status.success() {
      let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
      let path = PathBuf::from(path_str);
      if path.exists() { Some(path) } else { None }
   } else {
      None
   }
}

fn platform_binary_names(binary_name: &str) -> Vec<String> {
   if cfg!(windows) {
      vec![
         format!("{}.exe", binary_name),
         format!("{}.cmd", binary_name),
         binary_name.to_string(),
      ]
   } else {
      vec![binary_name.to_string()]
   }
}

fn first_existing(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
   candidates.into_iter().find(|path| path.exists())
}

fn find_managed_binary_in_runtime_tree(root: &Path, binary_name: &str) -> Option<PathBuf> {
   let entries = fs::read_dir(root).ok()?;

   for entry in entries.flatten() {
      let package_dir = entry.path();
      if !package_dir.is_dir() {
         continue;
      }

      let candidates: Vec<PathBuf> = match root.file_name().and_then(|name| name.to_str()) {
         Some("python") => platform_binary_names(binary_name)
            .into_iter()
            .flat_map(|name| {
               [
                  package_dir.join("bin").join(&name),
                  package_dir.join("Scripts").join(name),
               ]
            })
            .collect(),
         Some("ruby") => platform_binary_names(binary_name)
            .into_iter()
            .map(|name| package_dir.join("bin").join(name))
            .collect(),
         _ => platform_binary_names(binary_name)
            .into_iter()
            .map(|name| package_dir.join("node_modules").join(".bin").join(name))
            .collect(),
      };

      if let Some(path) = first_existing(candidates) {
         return Some(path);
      }
   }

   None
}

pub fn find_managed_binary(tools_dir: &Path, binary_name: &str) -> Option<PathBuf> {
   let mut direct_candidates = Vec::new();

   for name in platform_binary_names(binary_name) {
      direct_candidates.push(tools_dir.join("bin").join(&name));
      direct_candidates.push(tools_dir.join("go").join("bin").join(&name));
      direct_candidates.push(tools_dir.join("cargo").join("bin").join(&name));
   }

   if let Some(path) = first_existing(direct_candidates) {
      return Some(path);
   }

   for runtime_root in ["bun", "npm", "python", "ruby"] {
      if let Some(path) =
         find_managed_binary_in_runtime_tree(&tools_dir.join(runtime_root), binary_name)
      {
         return Some(path);
      }
   }

   None
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn finds_managed_binary_in_direct_tool_dirs() {
      let temp = tempfile::tempdir().unwrap();
      let binary = temp.path().join("cargo").join("bin").join("taplo");
      fs::create_dir_all(binary.parent().unwrap()).unwrap();
      fs::write(&binary, "").unwrap();

      let resolved = find_managed_binary(temp.path(), "taplo");

      assert_eq!(resolved.as_deref(), Some(binary.as_path()));
   }

   #[test]
   fn finds_managed_binary_in_bun_package_bin() {
      let temp = tempfile::tempdir().unwrap();
      let binary = temp
         .path()
         .join("bun")
         .join("typescript-language-server")
         .join("node_modules")
         .join(".bin")
         .join("typescript-language-server");
      fs::create_dir_all(binary.parent().unwrap()).unwrap();
      fs::write(&binary, "").unwrap();

      let resolved = find_managed_binary(temp.path(), "typescript-language-server");

      assert_eq!(resolved.as_deref(), Some(binary.as_path()));
   }

   #[test]
   fn finds_managed_binary_in_ruby_package_bin() {
      let temp = tempfile::tempdir().unwrap();
      let binary = temp
         .path()
         .join("ruby")
         .join("solargraph")
         .join("bin")
         .join(if cfg!(windows) {
            "solargraph.cmd"
         } else {
            "solargraph"
         });
      fs::create_dir_all(binary.parent().unwrap()).unwrap();
      fs::write(&binary, "").unwrap();

      let resolved = find_managed_binary(temp.path(), "solargraph");

      assert_eq!(resolved.as_deref(), Some(binary.as_path()));
   }
}
