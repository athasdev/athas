//! A scripted stand-in for the `docker` CLI that records every invocation.

use crate::Docker;
use std::{fs, path::Path};
use tempfile::TempDir;

/// How the fake CLI answers invocations whose space-joined arguments contain `pattern`.
pub(crate) struct Reply {
   pub pattern: &'static str,
   pub stdout: &'static [u8],
   pub stderr: &'static str,
   pub code: i32,
}

pub(crate) fn ok(pattern: &'static str, stdout: &'static str) -> Reply {
   Reply {
      pattern,
      stdout: stdout.as_bytes(),
      stderr: "",
      code: 0,
   }
}

pub(crate) fn fail(pattern: &'static str, stderr: &'static str, code: i32) -> Reply {
   Reply {
      pattern,
      stdout: b"",
      stderr,
      code,
   }
}

/// One recorded invocation: the working directory and the arguments.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Call {
   pub cwd: String,
   pub args: Vec<String>,
}

impl Call {
   pub fn line(&self) -> String {
      self.args.join(" ")
   }
}

pub(crate) struct FakeDocker {
   dir: TempDir,
   pub docker: Docker,
}

impl FakeDocker {
   /// The first matching reply wins; anything else exits 0 with no output.
   pub fn new(replies: Vec<Reply>) -> Self {
      let dir = tempfile::tempdir().expect("fake docker dir");
      let root = dir.path();
      let mut arms = String::new();
      for (index, reply) in replies.iter().enumerate() {
         let stdout = root.join(format!("reply-{index}.out"));
         let stderr = root.join(format!("reply-{index}.err"));
         fs::write(&stdout, reply.stdout).unwrap();
         fs::write(&stderr, reply.stderr).unwrap();
         arms.push_str(&format!(
            "  *{}*) cat {}; cat {} >&2; exit {} ;;\n",
            quote(reply.pattern),
            quote_path(&stdout),
            quote_path(&stderr),
            reply.code
         ));
      }
      let log = quote_path(&root.join("calls.log"));
      let stdin = quote_path(&root.join("stdin.txt"));
      let script = format!(
         "#!/bin/sh\nprintf '%s\\037' \"$(pwd -P)\" \"$@\" >> {log}\nprintf '\\n' >> {log}\ncase \
          \"$*\" in\n  'login '*) cat > {stdin} ;;\nesac\ncase \"$*\" in\n{arms}esac\nexit 0\n"
      );
      let program = root.join("docker");
      athas_test_support::write_executable(&program, &script);
      let docker = Docker::with_program(program);
      Self { dir, docker }
   }

   pub fn calls(&self) -> Vec<Call> {
      let Ok(log) = fs::read_to_string(self.dir.path().join("calls.log")) else {
         return Vec::new();
      };
      log.lines()
         .map(|line| {
            let mut parts = line
               .split('\u{1f}')
               .map(ToString::to_string)
               .collect::<Vec<_>>();
            parts.pop();
            let cwd = parts.remove(0);
            Call { cwd, args: parts }
         })
         .collect()
   }

   pub fn lines(&self) -> Vec<String> {
      self.calls().iter().map(Call::line).collect()
   }

   pub fn stdin(&self) -> String {
      fs::read_to_string(self.dir.path().join("stdin.txt")).unwrap_or_default()
   }
}

fn quote(value: &str) -> String {
   format!("'{}'", value.replace('\'', "'\\''"))
}

fn quote_path(path: &Path) -> String {
   quote(&path.to_string_lossy())
}
