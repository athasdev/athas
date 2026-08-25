use super::DockerContainerFileEntry;
use std::{collections::BTreeMap, io::Cursor};

type ArchiveEntry = (Vec<String>, bool, u64, Option<u64>, Option<String>);

pub(super) fn parse_container_file_archive(
   archive_bytes: &[u8],
   container_path: &str,
) -> Result<Vec<DockerContainerFileEntry>, String> {
   let mut archive = tar::Archive::new(Cursor::new(archive_bytes));
   let mut raw_entries = Vec::new();

   for entry in archive
      .entries()
      .map_err(|error| format!("Failed to read Docker copy archive: {}", error))?
   {
      let entry =
         entry.map_err(|error| format!("Failed to read Docker copy archive: {}", error))?;
      let path = entry
         .path()
         .map_err(|error| format!("Failed to read Docker copy archive path: {}", error))?
         .to_string_lossy()
         .replace('\\', "/");
      let components = path
         .split('/')
         .filter(|part| !part.is_empty() && *part != ".")
         .map(ToString::to_string)
         .collect::<Vec<_>>();
      let header = entry.header();
      raw_entries.push((
         components,
         header.entry_type().is_dir(),
         header.size().unwrap_or(0),
         header.mtime().ok(),
         header.mode().ok().map(|mode| format!("{:o}", mode)),
      ));
   }

   let strip_root = common_archive_root(&raw_entries, container_path);
   let mut entries = BTreeMap::<String, DockerContainerFileEntry>::new();

   for (mut components, is_directory, size, modified, mode) in raw_entries {
      if strip_root {
         if components.is_empty() {
            continue;
         }
         components.remove(0);
      }
      if components.is_empty() {
         continue;
      }

      let name = components[0].clone();
      let child_is_directory = is_directory || components.len() > 1;
      let entry = entries
         .entry(name.clone())
         .or_insert_with(|| DockerContainerFileEntry {
            path: join_container_path(container_path, &name),
            name,
            is_directory: child_is_directory,
            size: if child_is_directory { 0 } else { size },
            modified,
            mode: mode.clone(),
         });

      if child_is_directory {
         entry.is_directory = true;
         entry.size = 0;
      } else {
         entry.size = size;
      }
      if entry.modified.is_none() {
         entry.modified = modified;
      }
      if entry.mode.is_none() {
         entry.mode = mode;
      }
   }

   Ok(entries.into_values().collect())
}

fn common_archive_root(entries: &[ArchiveEntry], container_path: &str) -> bool {
   let Some(expected_root) = container_path
      .trim_end_matches('/')
      .rsplit('/')
      .find(|part| !part.is_empty())
   else {
      return false;
   };

   !entries.is_empty()
      && entries.iter().all(|(components, _, _, _, _)| {
         components.first().is_some_and(|part| part == expected_root)
      })
}

fn join_container_path(parent: &str, child: &str) -> String {
   if parent == "/" {
      format!("/{}", child)
   } else {
      format!("{}/{}", parent.trim_end_matches('/'), child)
   }
}
