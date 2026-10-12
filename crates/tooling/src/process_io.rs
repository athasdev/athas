//! Runs external tools over editor content without deadlocking on full pipes or hanging forever.

use std::{
   io::{self, Read, Write},
   process::{Child, Command, ExitStatus},
   thread::{self, JoinHandle},
   time::{Duration, Instant},
};

#[derive(Debug)]
pub(crate) enum ProcessError {
   Spawn(io::Error),
   WriteStdin(io::Error),
   Wait(io::Error),
   TimedOut,
}

pub(crate) struct ProcessOutput {
   pub(crate) status: ExitStatus,
   pub(crate) stdout: Vec<u8>,
   pub(crate) stderr: Vec<u8>,
}

/// Runs `command`, feeding `input` on its piped stdin while draining its piped stdout and stderr
/// on their own threads, so a tool that streams output before it has read all of its input
/// cannot deadlock against a full pipe. The process is killed once `timeout` passes.
pub(crate) fn run_process(
   mut command: Command,
   input: Option<&str>,
   timeout: Duration,
) -> Result<ProcessOutput, ProcessError> {
   let mut child = command.spawn().map_err(ProcessError::Spawn)?;

   let writer = match (input, child.stdin.take()) {
      (Some(input), Some(mut stdin)) => {
         let input = input.as_bytes().to_vec();
         Some(thread::spawn(move || stdin.write_all(&input)))
      }
      _ => None,
   };
   let stdout = child.stdout.take().map(drain);
   let stderr = child.stderr.take().map(drain);

   let status = wait_with_timeout(&mut child, timeout)?;

   if let Some(writer) = writer {
      match writer.join() {
         Ok(Ok(())) => {}
         Ok(Err(error)) => return Err(ProcessError::WriteStdin(error)),
         Err(_) => {
            return Err(ProcessError::WriteStdin(io::Error::other(
               "stdin writer panicked",
            )));
         }
      }
   }

   Ok(ProcessOutput {
      status,
      stdout: collect(stdout),
      stderr: collect(stderr),
   })
}

fn wait_with_timeout(child: &mut Child, timeout: Duration) -> Result<ExitStatus, ProcessError> {
   let deadline = Instant::now() + timeout;
   let mut poll_interval = Duration::from_millis(1);
   loop {
      match child.try_wait() {
         Ok(Some(status)) => return Ok(status),
         Ok(None) if Instant::now() >= deadline => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(ProcessError::TimedOut);
         }
         Ok(None) => {
            thread::sleep(poll_interval);
            poll_interval = (poll_interval * 2).min(Duration::from_millis(20));
         }
         Err(error) => {
            let _ = child.kill();
            return Err(ProcessError::Wait(error));
         }
      }
   }
}

fn drain(mut pipe: impl Read + Send + 'static) -> JoinHandle<Vec<u8>> {
   thread::spawn(move || {
      let mut bytes = Vec::new();
      let _ = pipe.read_to_end(&mut bytes);
      bytes
   })
}

fn collect(reader: Option<JoinHandle<Vec<u8>>>) -> Vec<u8> {
   reader
      .and_then(|reader| reader.join().ok())
      .unwrap_or_default()
}
