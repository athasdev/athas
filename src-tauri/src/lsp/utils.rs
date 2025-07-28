use anyhow::{Context, Result};
use std::{path::PathBuf, process::Command};

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
   Command::new("which")
      .arg(cmd)
      .output()
      .map(|output| output.status.success())
      .unwrap_or(false)
}

fn get_bun_global_bin() -> Result<PathBuf> {
   let output = Command::new("bun")
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
   let output = Command::new("npm")
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
