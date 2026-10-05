use crate::{
   ssh_helpers::{exec_remote_command, shell_quote},
   state::CONNECTIONS,
};
use athas_project::{
   file_mutations::{FILE_CHANGED, matches_expected},
   shell_file_mutations::{ShellTextMutation, TEXT_MUTATION_SCRIPT, TextExpectation},
};
use serde::{Deserialize, Serialize};
use ssh2::{ErrorCode, FileStat, OpenFlags, OpenType, RenameFlags, Session, Sftp};
use std::{
   io::{Read, Write},
   path::Path,
};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct RemoteFileEntry {
   pub name: String,
   pub path: String,
   pub is_dir: bool,
   pub size: u64,
   pub is_symlink: bool,
   pub target: Option<String>,
}

pub(super) async fn write_file(
   connection_id: String,
   file_path: String,
   content: String,
) -> Result<(), String> {
   mutate_file(connection_id, file_path, None, Some(content)).await
}

pub(super) async fn mutate_file(
   connection_id: String,
   file_path: String,
   expected: Option<Option<String>>,
   content: Option<String>,
) -> Result<(), String> {
   let request = ShellTextMutation::new(
      &file_path,
      match expected.as_ref() {
         None => TextExpectation::Any,
         Some(None) => TextExpectation::Missing,
         Some(Some(text)) => TextExpectation::Content(text),
      },
      content.as_deref(),
   )?;
   let connections = CONNECTIONS.lock().map_err(|error| error.to_string())?;
   let (session, sftp) = connections
      .get(&connection_id)
      .ok_or("Connection not found")?;
   if let Some(sftp) = sftp {
      return mutate_sftp(
         session,
         sftp,
         Path::new(&file_path),
         expected.as_ref(),
         content.as_deref(),
      );
   }
   let command = format!(
      "sh -c {} athas-edit {}",
      shell_quote(TEXT_MUTATION_SCRIPT),
      request
         .arguments
         .iter()
         .map(|value| shell_quote(value))
         .collect::<Vec<_>>()
         .join(" ")
   );
   let mut channel = session
      .channel_session()
      .map_err(|error| error.to_string())?;
   channel.exec(&command).map_err(|error| error.to_string())?;
   let write_result = channel.write_all(&request.input);
   channel.send_eof().map_err(|error| error.to_string())?;
   let mut output = String::new();
   let mut error_output = String::new();
   channel
      .read_to_string(&mut output)
      .map_err(|error| error.to_string())?;
   channel
      .stderr()
      .read_to_string(&mut error_output)
      .map_err(|error| error.to_string())?;
   channel.close().map_err(|error| error.to_string())?;
   channel.wait_close().map_err(|error| error.to_string())?;
   if channel.exit_status().map_err(|error| error.to_string())? != 0 {
      return Err(if error_output.trim().is_empty() {
         "Remote file update failed.".into()
      } else {
         error_output.trim().into()
      });
   }
   write_result.map_err(|error| error.to_string())
}

fn sftp_metadata(sftp: &Sftp, path: &Path) -> Result<Option<FileStat>, String> {
   match sftp.lstat(path) {
      Ok(stat) => Ok(Some(stat)),
      Err(error) if error.code() == ErrorCode::SFTP(2) => Ok(None),
      Err(error) => Err(error.to_string()),
   }
}

fn sftp_text(sftp: &Sftp, path: &Path, limit: Option<u64>) -> Result<Option<String>, String> {
   let file = match sftp.open(path) {
      Ok(file) => file,
      Err(error) if error.code() == ErrorCode::SFTP(2) => return Ok(None),
      Err(error) => return Err(error.to_string()),
   };
   let mut bytes = Vec::new();
   file
      .take(limit.unwrap_or(u64::MAX).saturating_add(1))
      .read_to_end(&mut bytes)
      .map_err(|error| error.to_string())?;
   if limit.is_some_and(|limit| bytes.len() as u64 > limit) {
      return Err(FILE_CHANGED.into());
   }
   String::from_utf8(bytes)
      .map(Some)
      .map_err(|error| error.to_string())
}

fn mutate_sftp(
   session: &Session,
   sftp: &Sftp,
   path: &Path,
   expected: Option<&Option<String>>,
   content: Option<&str>,
) -> Result<(), String> {
   let metadata = sftp_metadata(sftp, path)?;
   let target = if metadata
      .as_ref()
      .is_some_and(|stat| stat.file_type() == ssh2::FileType::Symlink)
   {
      sftp.realpath(path).map_err(|error| error.to_string())?
   } else {
      path.to_path_buf()
   };
   let metadata = sftp_metadata(sftp, &target)?;
   if metadata.as_ref().is_some_and(|stat| !stat.is_file()) {
      return Err("Only text files can be changed.".into());
   }
   if path != target && metadata.is_none() {
      return Err("The symlink target does not exist.".into());
   }
   if expected == Some(&None) && metadata.is_some() {
      return Err(FILE_CHANGED.into());
   }
   let limit = expected.map(|previous| {
      previous
         .as_ref()
         .map_or(0, String::len)
         .max(content.map_or(0, str::len)) as u64
         + 3
   });
   let previous = sftp_text(sftp, &target, limit)?;
   if expected.is_some_and(|expected| !matches_expected(previous.as_deref(), expected.as_deref())) {
      return Err(FILE_CHANGED.into());
   }
   let content = content.map(|text| {
      if previous
         .as_ref()
         .is_some_and(|old| old.starts_with('\u{feff}'))
         && !text.starts_with('\u{feff}')
      {
         format!("\u{feff}{text}")
      } else {
         text.to_string()
      }
   });
   if content == previous {
      return Ok(());
   }
   if metadata
      .as_ref()
      .and_then(|stat| stat.perm)
      .is_some_and(|mode| mode & 0o222 == 0)
   {
      return Err("The file is read-only.".into());
   }
   let Some(content) = content else {
      if sftp_text(sftp, &target, limit)? != previous {
         return Err(FILE_CHANGED.into());
      }
      return sftp.unlink(&target).map_err(|error| error.to_string());
   };
   let parent = target.parent().ok_or("Missing parent directory.")?;
   for directory in parent.ancestors().collect::<Vec<_>>().into_iter().rev() {
      if sftp_metadata(sftp, directory)?.is_none() {
         sftp
            .mkdir(directory, 0o777)
            .map_err(|error| error.to_string())?;
      }
   }
   let temporary = parent.join(format!(".athas-edit-{}", uuid::Uuid::new_v4()));
   let mut created = false;
   let result = (|| {
      let mut file = sftp
         .open_mode(
            &temporary,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::EXCLUSIVE,
            0o666,
            OpenType::File,
         )
         .map_err(|error| error.to_string())?;
      created = true;
      let default_permissions = file.stat().map_err(|error| error.to_string())?.perm;
      file
         .setstat(permission_stat(Some(0o600)))
         .map_err(|error| error.to_string())?;
      file
         .write_all(content.as_bytes())
         .map_err(|error| error.to_string())?;
      file.close().map_err(|error| error.to_string())?;
      let permissions = metadata.and_then(|stat| stat.perm).or(default_permissions);
      sftp
         .setstat(&temporary, permission_stat(permissions))
         .map_err(|error| error.to_string())?;
      if sftp_text(sftp, &target, limit)? != previous {
         return Err(FILE_CHANGED.into());
      }
      let flags = if previous.is_some() {
         RenameFlags::ATOMIC | RenameFlags::NATIVE | RenameFlags::OVERWRITE
      } else {
         RenameFlags::ATOMIC | RenameFlags::NATIVE
      };
      match sftp.rename(&temporary, &target, Some(flags)) {
         Ok(()) => Ok(()),
         Err(error) if previous.is_some() && matches!(error.code(), ErrorCode::SFTP(4 | 8)) => {
            if sftp_text(sftp, &target, limit)? != previous {
               return Err(FILE_CHANGED.into());
            }
            crate::sftp_atomic_rename::overwrite_file_atomically(session, &temporary, &target)
         }
         Err(error) => Err(error.to_string()),
      }
   })();
   if created && result.is_err() {
      let _ = sftp.unlink(&temporary);
   }
   result
}

fn permission_stat(perm: Option<u32>) -> FileStat {
   FileStat {
      size: None,
      uid: None,
      gid: None,
      perm,
      atime: None,
      mtime: None,
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
            if name == "." || name == ".." {
               return None;
            }
            let full_path = path_buf.to_string_lossy().to_string();
            let is_symlink = stat.file_type() == ssh2::FileType::Symlink;
            let target = if is_symlink {
               sftp
                  .readlink(&path_buf)
                  .ok()
                  .map(|path| path.to_string_lossy().into_owned())
            } else {
               None
            };
            let is_dir = stat.is_dir()
               || (is_symlink && sftp.stat(&path_buf).is_ok_and(|stat| stat.is_dir()));
            Some(RemoteFileEntry {
               name,
               path: full_path,
               is_dir,
               size: stat.size.unwrap_or(0),
               is_symlink,
               target,
            })
         })
         .collect();

      sort_entries(&mut result);

      Ok(result)
   } else {
      let command = format!(
         "sh -c {} athas-list-dir {}",
         shell_quote(DIRECTORY_LIST_SCRIPT),
         shell_quote(dir_path)
      );
      let output = exec_remote_command(session, &command)?;
      let mut entries = parse_directory_entries(&output)?;
      sort_entries(&mut entries);
      Ok(entries)
   }
}

fn sort_entries(entries: &mut [RemoteFileEntry]) {
   entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
      (true, false) => std::cmp::Ordering::Less,
      (false, true) => std::cmp::Ordering::Greater,
      _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
   });
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
      exec_remote_command(session, &format!("cat -- {}", shell_quote(&file_path)))
   }
}

const DIRECTORY_LIST_SCRIPT: &str = r#"set -eu
[ -d "$1" ] && [ -r "$1" ] && [ -x "$1" ] || { printf 'Directory is not readable.\n' >&2; exit 1; }
for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do
  [ -e "$p" ] || [ -L "$p" ] || continue
  kind=f; [ ! -d "$p" ] || kind=d
  linked=false; target=
  if [ -L "$p" ]; then linked=true; target=$(readlink "$p"); fi
  size=0
  if [ -f "$p" ]; then size=$(wc -c < "$p" 2>/dev/null || printf 0); fi
  printf '%s\0%s\0%s\0%s\0%s\0%s\0' "${p##*/}" "$p" "$kind" "$size" "$linked" "$target"
done"#;

fn parse_directory_entries(output: &str) -> Result<Vec<RemoteFileEntry>, String> {
   let fields = output.split_terminator('\0').collect::<Vec<_>>();
   if !fields.len().is_multiple_of(6) {
      return Err("Invalid remote directory listing.".into());
   }
   let (entries, _) = fields.as_chunks::<6>();
   entries
      .iter()
      .map(|[name, path, kind, size, linked, target]| {
         Ok(RemoteFileEntry {
            name: (*name).into(),
            path: (*path).into(),
            is_dir: *kind == "d",
            size: size
               .trim()
               .parse::<u64>()
               .map_err(|error| error.to_string())?,
            is_symlink: *linked == "true",
            target: (!target.is_empty()).then(|| (*target).into()),
         })
      })
      .collect()
}

#[cfg(test)]
mod tests {
   use super::*;

   #[cfg(unix)]
   #[test]
   fn shell_listing_preserves_hidden_files_newlines_and_symlink_metadata() {
      use std::{fs, os::unix::fs::symlink, process::Command};
      let root = std::env::temp_dir().join(format!("athas-remote-list-{}", uuid::Uuid::new_v4()));
      fs::create_dir(&root).unwrap();
      fs::write(root.join(".aiignore"), "private/").unwrap();
      fs::write(root.join("it's a\nfile.txt"), "text").unwrap();
      fs::create_dir(root.join("folder")).unwrap();
      symlink(root.join("folder"), root.join("linked")).unwrap();
      let output = Command::new("sh")
         .args(["-c", DIRECTORY_LIST_SCRIPT, "athas-list-dir"])
         .arg(&root)
         .output()
         .unwrap();
      assert!(
         output.status.success(),
         "{}",
         String::from_utf8_lossy(&output.stderr)
      );
      let entries = parse_directory_entries(&String::from_utf8(output.stdout).unwrap()).unwrap();
      assert_eq!(entries.len(), 4);
      assert!(entries.iter().any(|entry| entry.name == ".aiignore"));
      assert!(
         entries
            .iter()
            .any(|entry| entry.name == "it's a\nfile.txt" && entry.size == 4)
      );
      let linked = entries.iter().find(|entry| entry.name == "linked").unwrap();
      assert!(linked.is_dir && linked.is_symlink);
      fs::remove_dir_all(root).unwrap();
   }

   #[test]
   fn shell_listing_is_sorted_like_the_sftp_listing() {
      let frame = |name: &str, kind: &str| format!("{name}\0/srv/app/{name}\0{kind}\00\0false\0\0");
      let output = ["README.md", "src", "two  spaces.txt", "Assets", "b.txt"]
         .iter()
         .map(|name| frame(name, if name.contains('.') { "f" } else { "d" }))
         .collect::<String>();
      let mut entries = parse_directory_entries(&output).unwrap();
      sort_entries(&mut entries);
      assert_eq!(
         entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>(),
         vec!["Assets", "src", "b.txt", "README.md", "two  spaces.txt"]
      );
      assert!(
         entries
            .iter()
            .any(|entry| entry.path == "/srv/app/two  spaces.txt")
      );
   }

   #[test]
   fn invalid_directory_frames_fail_instead_of_hiding_entries() {
      assert!(parse_directory_entries("truncated\0file").is_err());
      assert!(parse_directory_entries("a\0/a\0f\0not-a-size\0false\0\0").is_err());
   }
}

#[cfg(all(test, unix))]
mod transport_tests {
   use super::*;
   use std::{
      fs,
      net::TcpStream,
      os::unix::fs::{PermissionsExt, symlink},
   };

   #[test]
   #[ignore = "Requires a disposable localhost SSH server and temporary test keys."]
   fn guarded_file_operations_over_real_ssh_and_sftp() {
      let address = std::env::var("ATHAS_TEST_SSH_ADDRESS").expect("Test SSH address required");
      assert!(
         address.starts_with("127.0.0.1:"),
         "Only a localhost fixture is allowed"
      );
      let username = std::env::var("ATHAS_TEST_SSH_USER").unwrap();
      let key = std::env::var("ATHAS_TEST_SSH_KEY").unwrap();
      for use_sftp in [true, false] {
         let stream = TcpStream::connect(&address).unwrap();
         let mut session = ssh2::Session::new().unwrap();
         session.set_timeout(10_000);
         session.set_tcp_stream(stream);
         session.handshake().unwrap();
         let hosts_path =
            std::env::var("ATHAS_TEST_SSH_HOSTS").expect("Trusted fixture host keys required");
         let mut hosts = session.known_hosts().unwrap();
         hosts
            .read_file(Path::new(&hosts_path), ssh2::KnownHostFileKind::OpenSSH)
            .unwrap();
         let port = address.rsplit_once(':').unwrap().1.parse::<u16>().unwrap();
         assert!(matches!(
            hosts.check_port("127.0.0.1", port, session.host_key().unwrap().0),
            ssh2::CheckResult::Match
         ));
         session
            .userauth_pubkey_file(&username, None, Path::new(&key), None)
            .unwrap();
         let sftp = use_sftp.then(|| session.sftp().unwrap());
         let id = format!("test-{}", uuid::Uuid::new_v4());
         CONNECTIONS
            .lock()
            .unwrap()
            .insert(id.clone(), (session, sftp));
         struct Disconnect(String);
         impl Drop for Disconnect {
            fn drop(&mut self) {
               CONNECTIONS.lock().unwrap().remove(&self.0);
            }
         }
         let disconnect = Disconnect(id.clone());
         let dir = tempfile::tempdir().unwrap();
         let path = dir.path().join("it's a\nfile.txt");
         let path_string = path.to_str().unwrap().to_string();
         fs::write(&path, "before\r\n").unwrap();
         fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
         let run = |expected: Option<Option<String>>, content: Option<String>| {
            tauri::async_runtime::block_on(mutate_file(
               id.clone(),
               path_string.clone(),
               expected,
               content,
            ))
         };
         assert!(run(Some(Some("stale".into())), Some("after".into())).is_err());
         assert_eq!(fs::read_to_string(&path).unwrap(), "before\r\n");
         run(
            Some(Some("before\r\n".into())),
            Some("こんにちは\r\n".into()),
         )
         .unwrap();
         assert_eq!(fs::read_to_string(&path).unwrap(), "こんにちは\r\n");
         assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o755
         );
         assert!(run(Some(None), Some("created".into())).is_err());
         assert!(run(Some(Some("before\r\n".into())), None).is_err());
         fs::write(dir.path().join(".aiignore"), "private/").unwrap();
         let link = dir.path().join("link.txt");
         symlink(&path, &link).unwrap();
         let entries = tauri::async_runtime::block_on(read_directory(
            id.clone(),
            dir.path().to_str().unwrap().into(),
         ))
         .unwrap();
         assert!(entries.iter().any(|entry| entry.name == ".aiignore"));
         assert!(
            entries
               .iter()
               .any(|entry| entry.name == "link.txt" && entry.is_symlink)
         );
         tauri::async_runtime::block_on(mutate_file(
            id.clone(),
            link.to_str().unwrap().into(),
            Some(Some("こんにちは\r\n".into())),
            Some("through link".into()),
         ))
         .unwrap();
         assert_eq!(fs::read_to_string(&path).unwrap(), "through link");
         assert!(
            fs::symlink_metadata(&link)
               .unwrap()
               .file_type()
               .is_symlink()
         );
         fs::write(&path, "concurrent baseline").unwrap();
         let start = std::sync::Arc::new(std::sync::Barrier::new(8));
         let threads = (0..8)
            .map(|index| {
               let start = start.clone();
               let id = id.clone();
               let path = path_string.clone();
               std::thread::spawn(move || {
                  start.wait();
                  tauri::async_runtime::block_on(mutate_file(
                     id,
                     path,
                     Some(Some("concurrent baseline".into())),
                     Some(format!("writer {index}")),
                  ))
               })
            })
            .collect::<Vec<_>>();
         assert_eq!(
            threads
               .into_iter()
               .map(|thread| thread.join().unwrap())
               .filter(Result::is_ok)
               .count(),
            1
         );
         let current = fs::read_to_string(&path).unwrap();
         run(Some(Some(current)), None).unwrap();
         assert!(!path.exists());
         fs::remove_file(&link).unwrap();
         run(Some(None), Some("restored".into())).unwrap();
         assert_eq!(fs::read_to_string(&path).unwrap(), "restored");
         let missing = dir.path().join("missing.txt").to_str().unwrap().to_string();
         assert!(tauri::async_runtime::block_on(read_file(id.clone(), missing)).is_err());
         assert!(fs::read_dir(dir.path()).unwrap().all(|entry| {
            !entry
               .unwrap()
               .file_name()
               .to_string_lossy()
               .starts_with(".athas-edit")
         }));
         drop(disconnect);
      }
   }
}
