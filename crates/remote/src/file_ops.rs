use crate::{ssh_helpers::shell_quote, state::CONNECTIONS};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RemoteFileEntry {
   pub name: String,
   pub path: String,
   pub is_dir: bool,
   pub size: u64,
}

pub(super) async fn write_file(
   connection_id: String,
   file_path: String,
   content: String,
) -> Result<(), String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, sftp_opt) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   if let Some(sftp) = sftp_opt {
      let remote_path = std::path::Path::new(&file_path);
      let mut file = sftp
         .create(remote_path)
         .map_err(|e| format!("Failed to create file: {}", e))?;

      file
         .write_all(content.as_bytes())
         .map_err(|e| format!("Failed to write file: {}", e))?;

      Ok(())
   } else {
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("cat > '{}'", file_path.replace('\'', "'\\''"));
      channel
         .exec(&command)
         .map_err(|e| format!("Failed to execute command: {}", e))?;

      channel
         .write_all(content.as_bytes())
         .map_err(|e| format!("Failed to write content: {}", e))?;

      channel
         .send_eof()
         .map_err(|e| format!("Failed to send EOF: {}", e))?;

      channel.close().ok();
      channel.wait_close().ok();
      Ok(())
   }
}

pub(super) async fn read_directory(
   connection_id: String,
   path: String,
) -> Result<Vec<RemoteFileEntry>, String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, sftp_opt) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   let dir_path = if path.is_empty() { "/" } else { &path };

   if let Some(sftp) = sftp_opt {
      let remote_path = std::path::Path::new(dir_path);
      let entries = sftp
         .readdir(remote_path)
         .map_err(|e| format!("Failed to read directory: {}", e))?;

      let mut result: Vec<RemoteFileEntry> = entries
         .into_iter()
         .filter_map(|(path_buf, stat)| {
            let name = path_buf.file_name()?.to_string_lossy().to_string();
            if name.starts_with('.') {
               return None;
            }
            let full_path = path_buf.to_string_lossy().to_string();
            Some(RemoteFileEntry {
               name,
               path: full_path,
               is_dir: stat.is_dir(),
               size: stat.size.unwrap_or(0),
            })
         })
         .collect();

      sort_entries(&mut result);

      Ok(result)
   } else {
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("ls -la {}", shell_quote(dir_path));
      channel
         .exec(&command)
         .map_err(|e| format!("Failed to execute command: {}", e))?;

      let mut output = String::new();
      channel
         .read_to_string(&mut output)
         .map_err(|e| format!("Failed to read output: {}", e))?;

      channel.close().ok();
      channel.wait_close().ok();

      Ok(parse_ls_entries(&output, dir_path))
   }
}

fn sort_entries(entries: &mut [RemoteFileEntry]) {
   entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
      (true, false) => std::cmp::Ordering::Less,
      (false, true) => std::cmp::Ordering::Greater,
      _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
   });
}

/// Returns the remainder of `line` starting at its whitespace-separated
/// field `index`, preserving the original spacing inside that remainder.
fn rest_from_field(line: &str, index: usize) -> Option<&str> {
   let mut fields_seen = 0;
   let mut in_field = false;
   for (offset, ch) in line.char_indices() {
      if ch.is_whitespace() {
         in_field = false;
      } else if !in_field {
         if fields_seen == index {
            return Some(&line[offset..]);
         }
         fields_seen += 1;
         in_field = true;
      }
   }
   None
}

/// Parses `ls -la` output for the shell fallback used when SFTP is not
/// available, matching the SFTP listing's filtering and ordering.
fn parse_ls_entries(output: &str, dir_path: &str) -> Vec<RemoteFileEntry> {
   let parent = dir_path.trim_end_matches('/');
   let mut entries: Vec<RemoteFileEntry> = output
      .lines()
      .filter_map(|line| {
         let parts: Vec<&str> = line.split_whitespace().take(8).collect();
         if parts.len() < 8 {
            return None;
         }
         let mut name = rest_from_field(line, 8)?;
         let is_symlink = parts[0].starts_with('l');
         if is_symlink && let Some((link_name, _target)) = name.split_once(" -> ") {
            name = link_name;
         }
         if name.starts_with('.') {
            return None;
         }
         Some(RemoteFileEntry {
            name: name.to_string(),
            path: format!("{}/{}", parent, name),
            is_dir: parts[0].starts_with('d'),
            size: parts[4].parse().unwrap_or(0),
         })
      })
      .collect();

   sort_entries(&mut entries);
   entries
}

pub(super) async fn read_file(connection_id: String, file_path: String) -> Result<String, String> {
   let connections = CONNECTIONS
      .lock()
      .map_err(|e| format!("Failed to lock connections: {}", e))?;
   let (session, sftp_opt) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;

   if let Some(sftp) = sftp_opt {
      let remote_path = std::path::Path::new(&file_path);
      let mut file = sftp
         .open(remote_path)
         .map_err(|e| format!("Failed to open file: {}", e))?;

      let mut content = String::new();
      file
         .read_to_string(&mut content)
         .map_err(|e| format!("Failed to read file: {}", e))?;

      Ok(content)
   } else {
      let mut channel = session
         .channel_session()
         .map_err(|e| format!("Failed to create channel: {}", e))?;

      let command = format!("cat '{}'", file_path.replace('\'', "'\\''"));
      channel
         .exec(&command)
         .map_err(|e| format!("Failed to execute command: {}", e))?;

      let mut content = String::new();
      channel
         .read_to_string(&mut content)
         .map_err(|e| format!("Failed to read file: {}", e))?;

      channel.close().ok();
      channel.wait_close().ok();

      Ok(content)
   }
}

#[cfg(test)]
mod tests {
   use super::*;

   const LS_OUTPUT: &str = "\
total 24
drwxr-xr-x  5 me staff  160 Jan  1 10:00 .
drwxr-xr-x 10 me staff  320 Jan  1 10:00 ..
-rw-r--r--  1 me staff   12 Jan  1 10:00 .env
-rw-r--r--  1 me staff 1024 Jan  1 10:00 README.md
drwxr-xr-x  2 me staff   64 Jan  1 10:00 src
-rw-r--r--  1 me staff    7 Jan  1 10:00 two  spaces.txt
lrwxr-xr-x  1 me staff    9 Jan  1 10:00 latest -> releases/v2
drwxr-xr-x  2 me staff   64 Jan  1 10:00 Assets
";

   fn names(entries: &[RemoteFileEntry]) -> Vec<&str> {
      entries.iter().map(|entry| entry.name.as_str()).collect()
   }

   #[test]
   fn parses_ls_output_into_sorted_visible_entries() {
      let entries = parse_ls_entries(LS_OUTPUT, "/srv/app");

      assert_eq!(
         names(&entries),
         vec!["Assets", "src", "latest", "README.md", "two  spaces.txt"]
      );
      let readme = entries
         .iter()
         .find(|entry| entry.name == "README.md")
         .unwrap();
      assert_eq!(readme.path, "/srv/app/README.md");
      assert_eq!(readme.size, 1024);
      assert!(!readme.is_dir);
      assert!(
         entries
            .iter()
            .find(|entry| entry.name == "src")
            .unwrap()
            .is_dir
      );
   }

   #[test]
   fn strips_symlink_targets_and_keeps_inner_spacing() {
      let entries = parse_ls_entries(LS_OUTPUT, "/srv/app");

      let link = entries.iter().find(|entry| entry.name == "latest").unwrap();
      assert_eq!(link.path, "/srv/app/latest");
      assert!(
         entries
            .iter()
            .any(|entry| entry.path == "/srv/app/two  spaces.txt")
      );
   }

   #[test]
   fn joins_paths_under_root_and_trailing_slashes_without_doubling() {
      let line = "-rw-r--r-- 1 root root 5 Jan  1 10:00 file\n";
      assert_eq!(parse_ls_entries(line, "/")[0].path, "/file");
      assert_eq!(parse_ls_entries(line, "/home/me/")[0].path, "/home/me/file");
   }

   #[test]
   fn ignores_short_and_malformed_lines() {
      assert!(parse_ls_entries("total 0\n\nls: cannot access\n", "/").is_empty());
   }
}
