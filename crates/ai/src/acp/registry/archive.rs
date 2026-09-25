//! Unpacks downloaded agent builds without letting an archive write outside its directory.

use std::{
   fs::{self, File},
   io::{self, Read},
   path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
   Zip,
   TarGz,
   TarBz2,
   /// The download is the executable itself.
   Raw,
}

/// The archive format named by a download URL's path. Anything that is not a supported archive
/// is treated as the executable itself.
pub fn archive_kind(url: &str) -> ArchiveKind {
   let path = url
      .split(['?', '#'])
      .next()
      .unwrap_or(url)
      .to_ascii_lowercase();
   if path.ends_with(".zip") {
      ArchiveKind::Zip
   } else if path.ends_with(".tar.gz") || path.ends_with(".tgz") {
      ArchiveKind::TarGz
   } else if path.ends_with(".tar.bz2") || path.ends_with(".tbz2") {
      ArchiveKind::TarBz2
   } else {
      ArchiveKind::Raw
   }
}

/// A relative path that stays inside the directory it is joined to: no root, drive prefix or
/// `..`. Backslashes count as separators, since Windows archives and registry commands use them.
pub fn safe_relative_path(path: &str) -> Option<PathBuf> {
   let normalized = path.replace('\\', "/");
   let mut result = PathBuf::new();
   for component in Path::new(&normalized).components() {
      match component {
         Component::Normal(part) => result.push(part),
         Component::CurDir => {}
         Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
      }
   }
   (!result.as_os_str().is_empty()).then_some(result)
}

/// Whether a link at `link` (relative to the archive root) pointing at `target` resolves inside
/// the archive root.
fn link_stays_inside(link: &Path, target: &Path) -> bool {
   if target.is_absolute() || target.has_root() {
      return false;
   }
   let mut depth: usize = link.parent().map_or(0, |parent| {
      parent
         .components()
         .filter(|component| matches!(component, Component::Normal(_)))
         .count()
   });
   for component in target.components() {
      match component {
         Component::Normal(_) => depth += 1,
         Component::CurDir => {}
         Component::ParentDir => {
            if depth == 0 {
               return false;
            }
            depth -= 1;
         }
         Component::RootDir | Component::Prefix(_) => return false,
      }
   }
   true
}

fn unsafe_entry(name: &str) -> io::Error {
   io::Error::new(
      io::ErrorKind::InvalidData,
      format!("Archive entry {name:?} would be written outside the install directory"),
   )
}

/// Unpacks `archive` into `destination`, which must already exist. `raw_name` names the file a
/// raw download is saved as.
pub fn extract(
   archive: &Path,
   kind: ArchiveKind,
   destination: &Path,
   raw_name: &str,
) -> io::Result<()> {
   match kind {
      ArchiveKind::Zip => extract_zip(archive, destination),
      ArchiveKind::TarGz => extract_tar(
         flate2::read::GzDecoder::new(File::open(archive)?),
         destination,
      ),
      ArchiveKind::TarBz2 => extract_tar(
         bzip2::read::BzDecoder::new(File::open(archive)?),
         destination,
      ),
      ArchiveKind::Raw => {
         let name = safe_relative_path(raw_name).ok_or_else(|| unsafe_entry(raw_name))?;
         let target = destination.join(name);
         if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
         }
         fs::copy(archive, target).map(|_| ())
      }
   }
}

fn extract_tar(reader: impl Read, destination: &Path) -> io::Result<()> {
   let mut archive = tar::Archive::new(reader);
   archive.set_preserve_permissions(true);
   archive.set_overwrite(true);
   for entry in archive.entries()? {
      let mut entry = entry?;
      let raw_path = entry.path()?.to_string_lossy().into_owned();
      let path = match safe_relative_path(&raw_path) {
         Some(path) => path,
         // The archive root itself (`./`).
         None if matches!(raw_path.trim_end_matches('/'), "" | ".") => continue,
         None => return Err(unsafe_entry(&raw_path)),
      };

      let entry_type = entry.header().entry_type();
      if entry_type.is_symlink() || entry_type.is_hard_link() {
         let target = entry
            .link_name()?
            .map(|target| target.into_owned())
            .unwrap_or_default();
         let inside = if entry_type.is_hard_link() {
            safe_relative_path(&target.to_string_lossy()).is_some()
         } else {
            link_stays_inside(&path, &target)
         };
         if !inside {
            return Err(unsafe_entry(&format!("{raw_path} -> {}", target.display())));
         }
      } else if !(entry_type.is_file() || entry_type.is_dir()) {
         // Devices, FIFOs and other special files are never needed to run an agent.
         continue;
      }

      if !entry.unpack_in(destination)? {
         return Err(unsafe_entry(&raw_path));
      }
   }
   Ok(())
}

fn extract_zip(archive: &Path, destination: &Path) -> io::Result<()> {
   let mut zip = zip::ZipArchive::new(File::open(archive)?).map_err(io::Error::other)?;
   for index in 0..zip.len() {
      let mut file = zip.by_index(index).map_err(io::Error::other)?;
      let name = file.name().to_string();
      let path = safe_relative_path(&name)
         .filter(|_| file.enclosed_name().is_some())
         .ok_or_else(|| unsafe_entry(&name))?;
      let target = destination.join(&path);

      if file.is_dir() {
         fs::create_dir_all(&target)?;
         continue;
      }
      if let Some(parent) = target.parent() {
         fs::create_dir_all(parent)?;
      }

      if file.is_symlink() {
         let mut link = String::new();
         file.read_to_string(&mut link)?;
         if !link_stays_inside(&path, Path::new(&link)) {
            return Err(unsafe_entry(&format!("{name} -> {link}")));
         }
         create_symlink(Path::new(&link), &target)?;
         continue;
      }

      let mut output = File::create(&target)?;
      io::copy(&mut file, &mut output)?;
      #[cfg(unix)]
      if let Some(mode) = file.unix_mode() {
         use std::os::unix::fs::PermissionsExt;
         fs::set_permissions(&target, fs::Permissions::from_mode(mode & 0o755))?;
      }
   }
   Ok(())
}

#[cfg(unix)]
fn create_symlink(target: &Path, link: &Path) -> io::Result<()> {
   std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn create_symlink(target: &Path, link: &Path) -> io::Result<()> {
   std::os::windows::fs::symlink_file(target, link)
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::io::Write;

   #[test]
   fn detects_archive_formats_from_urls() {
      assert_eq!(archive_kind("https://x/a.zip"), ArchiveKind::Zip);
      assert_eq!(
         archive_kind("https://x/a.tar.gz?download=1"),
         ArchiveKind::TarGz
      );
      assert_eq!(archive_kind("https://x/a.tgz"), ArchiveKind::TarGz);
      assert_eq!(archive_kind("https://x/a.tar.bz2"), ArchiveKind::TarBz2);
      assert_eq!(archive_kind("https://x/agent.exe"), ArchiveKind::Raw);
      assert_eq!(archive_kind("https://x/agent"), ArchiveKind::Raw);
   }

   #[test]
   fn safe_paths_stay_relative() {
      assert_eq!(
         safe_relative_path("./bin/agent"),
         Some(PathBuf::from("bin/agent"))
      );
      assert_eq!(
         safe_relative_path("./dist-package\\cursor-agent.cmd"),
         Some(PathBuf::from("dist-package/cursor-agent.cmd"))
      );
      assert_eq!(safe_relative_path("../escape"), None);
      assert_eq!(safe_relative_path("bin/../../escape"), None);
      assert_eq!(safe_relative_path("/etc/passwd"), None);
      assert_eq!(safe_relative_path("."), None);
   }

   #[test]
   fn links_must_resolve_inside_the_archive() {
      assert!(link_stays_inside(Path::new("a/b/link"), Path::new("../c")));
      assert!(!link_stays_inside(
         Path::new("a/link"),
         Path::new("../../c")
      ));
      assert!(!link_stays_inside(
         Path::new("link"),
         Path::new("/etc/passwd")
      ));
   }

   fn tar_gz_with(path: &str, contents: &[u8]) -> tempfile::NamedTempFile {
      let file = tempfile::NamedTempFile::new().unwrap();
      let encoder = flate2::write::GzEncoder::new(file.reopen().unwrap(), Default::default());
      let mut builder = tar::Builder::new(encoder);
      let mut header = tar::Header::new_gnu();
      header.set_size(contents.len() as u64);
      header.set_mode(0o755);
      // `set_path` refuses `..`, so write the name bytes directly like a hostile archive would.
      let name = header.as_old_mut().name.as_mut();
      name[..path.len()].copy_from_slice(path.as_bytes());
      header.set_cksum();
      builder.append(&header, contents).unwrap();
      builder.into_inner().unwrap().finish().unwrap();
      file
   }

   #[test]
   fn extracts_a_tar_gz() {
      let archive = tar_gz_with("bin/agent", b"#!/bin/sh\n");
      let destination = tempfile::tempdir().unwrap();
      extract(
         archive.path(),
         ArchiveKind::TarGz,
         destination.path(),
         "agent",
      )
      .unwrap();
      assert!(destination.path().join("bin/agent").is_file());
   }

   #[test]
   fn rejects_tar_path_traversal() {
      let archive = tar_gz_with("../escape", b"owned");
      let root = tempfile::tempdir().unwrap();
      let destination = root.path().join("install");
      fs::create_dir(&destination).unwrap();
      let error = extract(archive.path(), ArchiveKind::TarGz, &destination, "agent").unwrap_err();
      assert_eq!(error.kind(), io::ErrorKind::InvalidData);
      assert!(!root.path().join("escape").exists());
   }

   #[test]
   fn rejects_tar_symlinks_that_leave_the_archive() {
      let file = tempfile::NamedTempFile::new().unwrap();
      let encoder = flate2::write::GzEncoder::new(file.reopen().unwrap(), Default::default());
      let mut builder = tar::Builder::new(encoder);
      let mut header = tar::Header::new_gnu();
      header.set_entry_type(tar::EntryType::Symlink);
      header.set_size(0);
      builder
         .append_link(&mut header, "agent", "/usr/bin/env")
         .unwrap();
      builder.into_inner().unwrap().finish().unwrap();

      let destination = tempfile::tempdir().unwrap();
      assert!(extract(file.path(), ArchiveKind::TarGz, destination.path(), "agent").is_err());
   }

   fn zip_with(name: &str) -> tempfile::NamedTempFile {
      let file = tempfile::NamedTempFile::new().unwrap();
      let mut writer = zip::ZipWriter::new(file.reopen().unwrap());
      writer
         .start_file(
            name,
            zip::write::SimpleFileOptions::default().unix_permissions(0o755),
         )
         .unwrap();
      writer.write_all(b"agent").unwrap();
      writer.finish().unwrap();
      file
   }

   #[test]
   fn extracts_a_zip_and_keeps_the_executable_bit() {
      let archive = zip_with("dist/agent");
      let destination = tempfile::tempdir().unwrap();
      extract(
         archive.path(),
         ArchiveKind::Zip,
         destination.path(),
         "agent",
      )
      .unwrap();
      let extracted = destination.path().join("dist/agent");
      assert!(extracted.is_file());
      #[cfg(unix)]
      {
         use std::os::unix::fs::PermissionsExt;
         assert_eq!(
            fs::metadata(extracted).unwrap().permissions().mode() & 0o111,
            0o111
         );
      }
   }

   #[test]
   fn rejects_zip_path_traversal() {
      let archive = zip_with("../../escape");
      let root = tempfile::tempdir().unwrap();
      let destination = root.path().join("install");
      fs::create_dir(&destination).unwrap();
      assert!(extract(archive.path(), ArchiveKind::Zip, &destination, "agent").is_err());
      assert!(!root.path().join("escape").exists());
   }

   #[test]
   fn saves_raw_downloads_under_the_command_name() {
      let download = tempfile::NamedTempFile::new().unwrap();
      fs::write(download.path(), b"binary").unwrap();
      let destination = tempfile::tempdir().unwrap();
      extract(
         download.path(),
         ArchiveKind::Raw,
         destination.path(),
         "./agent.exe",
      )
      .unwrap();
      assert!(destination.path().join("agent.exe").is_file());
      assert!(
         extract(
            download.path(),
            ArchiveKind::Raw,
            destination.path(),
            "../x"
         )
         .is_err()
      );
   }
}
