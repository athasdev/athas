use std::{fs, path::Path, process::Command};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinuxLibc {
   Gnu,
   Musl,
   Unknown,
}

pub fn target_os_token() -> &'static str {
   match std::env::consts::OS {
      "macos" => "apple-darwin",
      "windows" => "pc-windows-msvc",
      "linux" => match detect_linux_libc() {
         LinuxLibc::Musl => "unknown-linux-musl",
         LinuxLibc::Gnu | LinuxLibc::Unknown => "unknown-linux-gnu",
      },
      _ => "unknown-linux-gnu",
   }
}

pub fn detect_linux_libc() -> LinuxLibc {
   if std::env::consts::OS != "linux" {
      return LinuxLibc::Unknown;
   }

   if let Ok(override_value) = std::env::var("ATHAS_LINUX_LIBC") {
      match override_value.to_ascii_lowercase().as_str() {
         "musl" => return LinuxLibc::Musl,
         "gnu" | "glibc" => return LinuxLibc::Gnu,
         _ => {}
      }
   }

   if let Ok(os_release) = fs::read_to_string("/etc/os-release")
      && os_release_indicates_musl(&os_release)
   {
      return LinuxLibc::Musl;
   }

   if has_musl_loader(Path::new("/lib")) || has_musl_loader(Path::new("/usr/lib")) {
      return LinuxLibc::Musl;
   }

   if let Ok(output) = Command::new("ldd").arg("--version").output() {
      let ldd_output = format!(
         "{}{}",
         String::from_utf8_lossy(&output.stdout),
         String::from_utf8_lossy(&output.stderr)
      )
      .to_ascii_lowercase();

      if ldd_output.contains("musl") {
         return LinuxLibc::Musl;
      }

      if ldd_output.contains("glibc") || ldd_output.contains("gnu libc") {
         return LinuxLibc::Gnu;
      }
   }

   LinuxLibc::Unknown
}

fn os_release_indicates_musl(content: &str) -> bool {
   for line in content.lines() {
      let Some((key, value)) = line.split_once('=') else {
         continue;
      };

      if key != "ID" && key != "ID_LIKE" {
         continue;
      }

      let normalized = value
         .trim_matches('"')
         .split_ascii_whitespace()
         .map(|part| part.to_ascii_lowercase())
         .collect::<Vec<_>>();

      if normalized
         .iter()
         .any(|part| part == "alpine" || part == "chimera" || part == "musl")
      {
         return true;
      }
   }

   false
}

fn has_musl_loader(dir: &Path) -> bool {
   let Ok(entries) = fs::read_dir(dir) else {
      return false;
   };

   entries.filter_map(|entry| entry.ok()).any(|entry| {
      entry
         .file_name()
         .to_str()
         .is_some_and(|name| name.starts_with("ld-musl-") && name.ends_with(".so.1"))
   })
}

pub fn validate_downloaded_binary(path: &Path, tool_name: &str) -> Result<(), String> {
   if std::env::consts::OS != "linux" || detect_linux_libc() != LinuxLibc::Musl {
      return Ok(());
   }

   let bytes = fs::read(path).map_err(|e| {
      format!(
         "Failed to read downloaded binary for compatibility checks: {}",
         e
      )
   })?;
   let Some(linkage) = ElfLinkage::parse(&bytes)? else {
      return Ok(());
   };

   if !linkage.is_dynamic {
      return Ok(());
   }

   if linkage.uses_glibc_loader || linkage.mentions_glibc {
      return Err(format!(
         "{} downloaded a glibc-linked Linux binary, which is not compatible with musl systems \
          like Chimera Linux. Provide a statically linked binary or a \
          ${{targetOs}}=unknown-linux-musl asset.",
         tool_name
      ));
   }

   if linkage.mentions_gnu_cpp {
      return Err(format!(
         "{} downloaded a binary that depends on GNU libstdc++, but this system uses musl with \
          LLVM libc++. Provide a statically linked binary or a ${{targetOs}}=unknown-linux-musl \
          asset.",
         tool_name
      ));
   }

   Ok(())
}

#[derive(Debug)]
struct ElfLinkage {
   is_dynamic: bool,
   uses_glibc_loader: bool,
   mentions_glibc: bool,
   mentions_gnu_cpp: bool,
}

impl ElfLinkage {
   fn parse(bytes: &[u8]) -> Result<Option<Self>, String> {
      if bytes.len() < 64 || &bytes[0..4] != b"\x7fELF" {
         return Ok(None);
      }

      let class = bytes[4];
      let endian = bytes[5];
      if class != 1 && class != 2 {
         return Err("Unsupported ELF class in downloaded binary".to_string());
      }

      if endian != 1 && endian != 2 {
         return Err("Unsupported ELF endianness in downloaded binary".to_string());
      }

      let elf64 = class == 2;
      let phoff = if elf64 {
         read_u64(bytes, 32, endian)? as usize
      } else {
         read_u32(bytes, 28, endian)? as usize
      };
      let phentsize = if elf64 {
         read_u16(bytes, 54, endian)? as usize
      } else {
         read_u16(bytes, 42, endian)? as usize
      };
      let phnum = if elf64 {
         read_u16(bytes, 56, endian)? as usize
      } else {
         read_u16(bytes, 44, endian)? as usize
      };

      let mut is_dynamic = false;
      let mut interpreter = String::new();

      for index in 0..phnum {
         let offset = phoff
            .checked_add(index.saturating_mul(phentsize))
            .ok_or_else(|| "Invalid ELF program header offset".to_string())?;
         if offset + phentsize > bytes.len() {
            return Err("ELF program header extends past file end".to_string());
         }

         let segment_type = read_u32(bytes, offset, endian)?;
         if segment_type == 2 {
            is_dynamic = true;
            continue;
         }

         if segment_type != 3 {
            continue;
         }

         let (segment_offset, segment_size) = if elf64 {
            (
               read_u64(bytes, offset + 8, endian)? as usize,
               read_u64(bytes, offset + 32, endian)? as usize,
            )
         } else {
            (
               read_u32(bytes, offset + 4, endian)? as usize,
               read_u32(bytes, offset + 16, endian)? as usize,
            )
         };

         if segment_offset + segment_size <= bytes.len() {
            interpreter =
               String::from_utf8_lossy(&bytes[segment_offset..segment_offset + segment_size])
                  .trim_matches(char::from(0))
                  .to_string();
         }
      }

      Ok(Some(Self {
         is_dynamic: is_dynamic || !interpreter.is_empty(),
         uses_glibc_loader: interpreter.contains("ld-linux") || interpreter.contains("ld64.so"),
         mentions_glibc: contains_bytes(bytes, b"GLIBC_") || contains_bytes(bytes, b"libc.so.6"),
         mentions_gnu_cpp: contains_bytes(bytes, b"GLIBCXX_")
            || contains_bytes(bytes, b"libstdc++.so"),
      }))
   }
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
   haystack
      .windows(needle.len())
      .any(|window| window == needle)
}

fn read_u16(bytes: &[u8], offset: usize, endian: u8) -> Result<u16, String> {
   let slice = bytes
      .get(offset..offset + 2)
      .ok_or_else(|| "Unexpected end of ELF data".to_string())?;
   Ok(match endian {
      1 => u16::from_le_bytes([slice[0], slice[1]]),
      _ => u16::from_be_bytes([slice[0], slice[1]]),
   })
}

fn read_u32(bytes: &[u8], offset: usize, endian: u8) -> Result<u32, String> {
   let slice = bytes
      .get(offset..offset + 4)
      .ok_or_else(|| "Unexpected end of ELF data".to_string())?;
   Ok(match endian {
      1 => u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]),
      _ => u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]]),
   })
}

fn read_u64(bytes: &[u8], offset: usize, endian: u8) -> Result<u64, String> {
   let slice = bytes
      .get(offset..offset + 8)
      .ok_or_else(|| "Unexpected end of ELF data".to_string())?;
   Ok(match endian {
      1 => u64::from_le_bytes([
         slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
      ]),
      _ => u64::from_be_bytes([
         slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7],
      ]),
   })
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn detects_musl_distros_from_os_release() {
      assert!(os_release_indicates_musl(
         "ID=chimera\nNAME=Chimera Linux\n"
      ));
      assert!(os_release_indicates_musl(
         "ID=custom\nID_LIKE=\"alpine linux\"\n"
      ));
      assert!(!os_release_indicates_musl(
         "ID=fedora\nID_LIKE=\"rhel fedora\"\n"
      ));
   }

   #[test]
   fn skips_non_elf_files() {
      assert!(
         ElfLinkage::parse(b"#!/bin/sh\necho test")
            .unwrap()
            .is_none()
      );
   }

   #[test]
   fn detects_incompatible_dynamic_markers() {
      let mut elf = vec![0; 128];
      elf[0..4].copy_from_slice(b"\x7fELF");
      elf[4] = 2;
      elf[5] = 1;
      elf[32..40].copy_from_slice(&64_u64.to_le_bytes());
      elf[54..56].copy_from_slice(&56_u16.to_le_bytes());
      elf[56..58].copy_from_slice(&1_u16.to_le_bytes());
      elf[64..68].copy_from_slice(&2_u32.to_le_bytes());
      elf.extend_from_slice(b"libstdc++.so.6\0GLIBCXX_3.4\0");

      let linkage = ElfLinkage::parse(&elf).unwrap().unwrap();
      assert!(linkage.is_dynamic);
      assert!(linkage.mentions_gnu_cpp);
   }
}
