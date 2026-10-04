use crate::file_mutations::FILE_CHANGED;

pub enum TextExpectation<'a> {
   Any,
   Missing,
   Content(&'a str),
}

pub struct ShellTextMutation {
   pub arguments: Vec<String>,
   pub input: Vec<u8>,
}

impl ShellTextMutation {
   pub fn new(
      path: &str,
      expected: TextExpectation<'_>,
      content: Option<&str>,
   ) -> Result<Self, String> {
      Self::new_bytes(path, expected, content.map(str::as_bytes))
   }

   pub fn new_bytes(
      path: &str,
      expected: TextExpectation<'_>,
      content: Option<&[u8]>,
   ) -> Result<Self, String> {
      if !path.starts_with('/') || path.contains('\0') {
         return Err("Remote file paths must be absolute and contain no NUL bytes.".into());
      }
      let (expectation, previous) = match expected {
         TextExpectation::Any => ("any", ""),
         TextExpectation::Missing => ("missing", ""),
         TextExpectation::Content(text) => ("content", text),
      };
      let next = content.unwrap_or_default();
      let mut input = Vec::with_capacity(previous.len() + next.len());
      input.extend_from_slice(previous.as_bytes());
      input.extend_from_slice(next);
      Ok(Self {
         arguments: vec![
            path.into(),
            expectation.into(),
            previous.len().to_string(),
            next.len().to_string(),
            if content.is_some() { "write" } else { "delete" }.into(),
            FILE_CHANGED.into(),
         ],
         input,
      })
   }
}

// Content travels on stdin, never in command arguments or shell source.
pub const TEXT_MUTATION_SCRIPT: &str = r#"set -eu
path=$1
expectation=$2
previous_size=$3
next_size=$4
action=$5
changed=$6
scratch=$(mktemp -d "${TMPDIR:-/tmp}/athas-edit.XXXXXXXX")
stage=
trap 'rm -rf -- "$scratch"; if [ -n "$stage" ]; then rm -f -- "$stage"; fi' EXIT HUP INT TERM
cat > "$scratch/input"
[ "$(wc -c < "$scratch/input")" -eq "$((previous_size + next_size))" ] || { printf 'Incomplete file update.\n' >&2; exit 1; }
: > "$scratch/expected"
: > "$scratch/next"
if [ "$previous_size" -gt 0 ]; then head -c "$previous_size" "$scratch/input" > "$scratch/expected"; fi
if [ "$next_size" -gt 0 ]; then tail -c "$next_size" "$scratch/input" > "$scratch/next"; fi
if [ -L "$path" ]; then
  [ -e "$path" ] || { printf 'The symlink target does not exist.\n' >&2; exit 1; }
  resolved=$(realpath "$path" && printf x)
  resolved=${resolved%x}
  path=${resolved%?}
fi
exists=false
if [ -e "$path" ]; then
  [ -f "$path" ] || { printf 'Only text files can be changed.\n' >&2; exit 1; }
  exists=true
  cat -- "$path" > "$scratch/original"
fi
case "$expectation" in
  missing) [ "$exists" = false ] || { printf '%s\n' "$changed" >&2; exit 1; } ;;
  content)
    [ "$exists" = true ] || { printf '%s\n' "$changed" >&2; exit 1; }
    if ! cmp -s "$scratch/original" "$scratch/expected"; then
      printf '\357\273\277' > "$scratch/bom"
      head -c 3 "$scratch/original" > "$scratch/prefix"
      cmp -s "$scratch/prefix" "$scratch/bom" || { printf '%s\n' "$changed" >&2; exit 1; }
      tail -c +4 "$scratch/original" > "$scratch/decoded"
      cmp -s "$scratch/decoded" "$scratch/expected" || { printf '%s\n' "$changed" >&2; exit 1; }
    fi ;;
  any) ;;
  *) exit 1 ;;
esac
if [ "$exists" = true ]; then
  [ -w "$path" ] || { printf 'The file is read-only.\n' >&2; exit 1; }
fi
if [ "$action" = delete ]; then
  [ "$exists" = true ] || { printf '%s\n' "$changed" >&2; exit 1; }
  cmp -s "$scratch/original" "$path" || { printf '%s\n' "$changed" >&2; exit 1; }
  rm -- "$path"
  exit
fi
parent=${path%/*}
[ -n "$parent" ] || parent=/
mkdir -p -- "$parent"
stage=$(mktemp "$parent/.athas-edit.XXXXXXXX")
if [ "$exists" = true ]; then
  cp -p -- "$path" "$stage"
else
  mode=$(umask)
  chmod "$(printf '%o' "$((0666 & ~0$mode))")" "$stage"
fi
if [ "$exists" = true ]; then
  printf '\357\273\277' > "$scratch/bom"
  head -c 3 "$scratch/original" > "$scratch/prefix"
  head -c 3 "$scratch/next" > "$scratch/next-prefix"
  if cmp -s "$scratch/prefix" "$scratch/bom" && ! cmp -s "$scratch/next-prefix" "$scratch/bom"; then
    cat "$scratch/bom" "$scratch/next" > "$stage"
  else
    cat "$scratch/next" > "$stage"
  fi
  cmp -s "$scratch/original" "$path" || { printf '%s\n' "$changed" >&2; exit 1; }
  mv -f -- "$stage" "$path"
  stage=
else
  cat "$scratch/next" > "$stage"
  ln -- "$stage" "$path"
  if ! [ "$stage" -ef "$path" ]; then
    if [ "$stage" -ef "$path/${stage##*/}" ]; then rm -- "$path/${stage##*/}"; fi
    printf '%s\n' "$changed" >&2
    exit 1
  fi
fi"#;

#[cfg(all(test, unix))]
mod tests {
   use super::*;
   use std::{
      fs,
      io::Write,
      path::Path,
      process::{Command, Stdio},
   };

   fn run(path: &Path, expected: TextExpectation<'_>, content: Option<&str>) -> Result<(), String> {
      let request = ShellTextMutation::new(path.to_str().unwrap(), expected, content)?;
      execute(request)
   }

   fn execute(request: ShellTextMutation) -> Result<(), String> {
      let mut child = Command::new("sh")
         .args(["-c", TEXT_MUTATION_SCRIPT, "athas-edit"])
         .args(request.arguments)
         .stdin(Stdio::piped())
         .stdout(Stdio::piped())
         .stderr(Stdio::piped())
         .spawn()
         .unwrap();
      child
         .stdin
         .take()
         .unwrap()
         .write_all(&request.input)
         .unwrap();
      let output = child.wait_with_output().unwrap();
      if output.status.success() {
         Ok(())
      } else {
         Err(String::from_utf8_lossy(&output.stderr).into_owned())
      }
   }

   #[test]
   fn stale_replacements_and_deletions_preserve_current_text() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("a.txt");
      fs::write(&path, "newer").unwrap();
      assert!(run(&path, TextExpectation::Content("older"), Some("after")).is_err());
      assert!(run(&path, TextExpectation::Content("older"), None).is_err());
      assert_eq!(fs::read_to_string(path).unwrap(), "newer");
   }

   #[test]
   fn creates_missing_files_without_overwriting_existing_files() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("nested/a.txt");
      run(&path, TextExpectation::Missing, Some("created")).unwrap();
      assert!(run(&path, TextExpectation::Missing, Some("replace")).is_err());
      assert_eq!(fs::read_to_string(&path).unwrap(), "created");
      run(&path, TextExpectation::Content("created"), None).unwrap();
      assert!(!path.exists());
   }

   #[test]
   fn preserves_unicode_line_endings_and_shell_sensitive_names() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("it's $(touch injected)\nfile.txt");
      let before = "こんにちは\r\n\r\n";
      let after = "İstanbul $HOME `whoami`\r\n";
      fs::write(&path, before).unwrap();
      run(&path, TextExpectation::Content(before), Some(after)).unwrap();
      assert_eq!(fs::read_to_string(path).unwrap(), after);
      assert!(!dir.path().join("injected").exists());
   }

   #[test]
   fn preserves_bom_permissions_and_symlink_targets() {
      use std::os::unix::fs::{PermissionsExt, symlink};
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("script");
      let link = dir.path().join("link");
      fs::write(&path, "\u{feff}before\r\n").unwrap();
      fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
      symlink(&path, &link).unwrap();
      run(
         &link,
         TextExpectation::Content("before\r\n"),
         Some("after\r\n"),
      )
      .unwrap();
      assert_eq!(fs::read_to_string(&path).unwrap(), "\u{feff}after\r\n");
      assert_eq!(
         fs::metadata(path).unwrap().permissions().mode() & 0o777,
         0o755
      );
      assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
   }

   #[test]
   fn refuses_directories_and_broken_symlinks() {
      use std::os::unix::fs::symlink;
      let dir = tempfile::tempdir().unwrap();
      let link = dir.path().join("broken");
      symlink(dir.path().join("missing"), &link).unwrap();
      assert!(run(dir.path(), TextExpectation::Any, Some("after")).is_err());
      assert!(run(&link, TextExpectation::Missing, Some("after")).is_err());
      assert!(fs::symlink_metadata(link).unwrap().file_type().is_symlink());
   }

   #[test]
   fn incomplete_payloads_never_change_the_target() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("a.txt");
      fs::write(&path, "before").unwrap();
      let mut request = ShellTextMutation::new(
         path.to_str().unwrap(),
         TextExpectation::Content("before"),
         Some("after"),
      )
      .unwrap();
      request.input.pop();
      assert!(execute(request).is_err());
      assert_eq!(fs::read_to_string(path).unwrap(), "before");
   }

   #[test]
   fn content_is_not_put_in_command_arguments_and_large_writes_work() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("a.txt");
      let text = "secret".repeat(200_000);
      let request = ShellTextMutation::new(
         path.to_str().unwrap(),
         TextExpectation::Missing,
         Some(&text),
      )
      .unwrap();
      assert!(
         request
            .arguments
            .iter()
            .all(|argument| !argument.contains("secret"))
      );
      execute(request).unwrap();
      assert_eq!(fs::read_to_string(path).unwrap(), text);
   }
   #[test]
   fn supports_empty_replacements_and_preserves_binary_write_payloads() {
      let dir = tempfile::tempdir().unwrap();
      let path = dir.path().join("a.txt");
      fs::write(&path, "before").unwrap();
      run(&path, TextExpectation::Content("before"), Some("")).unwrap();
      assert_eq!(fs::read(&path).unwrap(), Vec::<u8>::new());
      let binary = [0xff, 0, 0xfe];
      let request =
         ShellTextMutation::new_bytes(path.to_str().unwrap(), TextExpectation::Any, Some(&binary))
            .unwrap();
      execute(request).unwrap();
      assert_eq!(fs::read(path).unwrap(), binary);
   }

   #[test]
   fn never_matches_a_missing_file_expectation_to_existing_text() {
      assert!(!crate::file_mutations::matches_expected(
         Some("plain"),
         None
      ));
      assert!(!crate::file_mutations::matches_expected(
         Some("\u{feff}plain"),
         None
      ));
      assert!(
         ShellTextMutation::new("relative/path", TextExpectation::Missing, Some("text")).is_err()
      );
      assert!(
         ShellTextMutation::new("/invalid\0path", TextExpectation::Missing, Some("text")).is_err()
      );
   }
}
