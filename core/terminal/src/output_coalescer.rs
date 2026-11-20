//! Merges PTY reads into fewer channel messages.
//!
//! A program streaming output makes the reader return many small chunks back to
//! back, and sending each one as its own IPC message floods the webview. Output
//! that follows the previous message within [`CoalesceConfig::burst_gap`] is
//! therefore held for up to [`CoalesceConfig::max_delay`] so later reads can join
//! it. Output after a quiet period, such as the echo of a keystroke, never waits:
//! it only absorbs chunks that are already queued.
//!
//! Output is held back while the frontend has paused the terminal, so the pause
//! threshold still bounds what reaches a slow xterm: after a pause, at most the
//! batch already being emitted gets through.

use crate::protocol::{TerminalEvent, TerminalReaderControl};
use std::{
   mem,
   sync::mpsc::{Receiver, RecvTimeoutError, TryRecvError},
   time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoalesceConfig {
   /// Longest a batch may wait for more output after its first chunk arrived.
   pub max_delay: Duration,
   /// Output arriving this soon after the previous message counts as streaming,
   /// and a streaming batch is sent once no new chunk has arrived for this long.
   pub burst_gap: Duration,
   /// A batch this large is sent without waiting for more, and a chunk that
   /// would push a batch past it is sent in the next one.
   pub max_bytes: usize,
}

impl Default for CoalesceConfig {
   fn default() -> Self {
      Self {
         max_delay: Duration::from_millis(4),
         burst_gap: Duration::from_millis(1),
         max_bytes: 64 * 1024,
      }
   }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoalesceStep {
   /// Nothing is pending; block until the next chunk.
   Idle,
   /// Send the pending batch now.
   Flush,
   /// Wait up to this long for another chunk before sending. Zero means only
   /// take chunks that are already queued.
   Collect(Duration),
}

#[derive(Debug)]
pub struct OutputCoalescer {
   config: CoalesceConfig,
   pending: Vec<u8>,
   batch_started_at: Option<Instant>,
   last_data_at: Option<Instant>,
   last_flush_at: Option<Instant>,
   streaming: bool,
}

impl OutputCoalescer {
   pub fn new(config: CoalesceConfig) -> Self {
      Self {
         config,
         pending: Vec::new(),
         batch_started_at: None,
         last_data_at: None,
         last_flush_at: None,
         streaming: false,
      }
   }

   pub fn push(&mut self, data: Vec<u8>, now: Instant) {
      if data.is_empty() {
         return;
      }
      if self.pending.is_empty() {
         self.streaming = self
            .last_flush_at
            .is_some_and(|flushed| now.saturating_duration_since(flushed) <= self.config.burst_gap);
         self.batch_started_at = Some(now);
         self.pending = data;
      } else {
         self.pending.extend_from_slice(&data);
      }
      self.last_data_at = Some(now);
   }

   pub fn would_overflow(&self, len: usize) -> bool {
      !self.pending.is_empty() && self.pending.len() + len > self.config.max_bytes
   }

   pub fn next_step(&self, now: Instant) -> CoalesceStep {
      if self.pending.is_empty() {
         return CoalesceStep::Idle;
      }
      if self.pending.len() >= self.config.max_bytes {
         return CoalesceStep::Flush;
      }
      if !self.streaming {
         return CoalesceStep::Collect(Duration::ZERO);
      }
      let (Some(started), Some(last_data)) = (self.batch_started_at, self.last_data_at) else {
         return CoalesceStep::Flush;
      };
      let deadline = (started + self.config.max_delay).min(last_data + self.config.burst_gap);
      let remaining = deadline.saturating_duration_since(now);
      if remaining.is_zero() {
         CoalesceStep::Flush
      } else {
         CoalesceStep::Collect(remaining)
      }
   }

   pub fn take(&mut self, now: Instant) -> Option<Vec<u8>> {
      if self.pending.is_empty() {
         return None;
      }
      self.batch_started_at = None;
      self.last_flush_at = Some(now);
      Some(mem::take(&mut self.pending))
   }
}

/// Forwards reader events to `emit`, merging consecutive output chunks. Any
/// other event first flushes the output before it so ordering is preserved, and
/// output waits while `control` is paused. Returns once the sender is gone or
/// `emit` reports the receiver is closed.
pub fn forward_coalesced(
   receiver: &Receiver<TerminalEvent>,
   control: &TerminalReaderControl,
   config: CoalesceConfig,
   mut emit: impl FnMut(TerminalEvent) -> bool,
) {
   let mut coalescer = OutputCoalescer::new(config);
   let flush = |coalescer: &mut OutputCoalescer, emit: &mut dyn FnMut(TerminalEvent) -> bool| {
      if coalescer.next_step(Instant::now()) == CoalesceStep::Idle {
         return true;
      }
      // Checked right before sending, so a pause stops every batch not yet on its way.
      if !control.wait_until_resumed() {
         return false;
      }
      coalescer
         .take(Instant::now())
         .is_none_or(|data| emit(TerminalEvent::Output { data }))
   };

   loop {
      let next = match coalescer.next_step(Instant::now()) {
         CoalesceStep::Idle => receiver.recv().ok(),
         CoalesceStep::Flush => {
            if !flush(&mut coalescer, &mut emit) {
               return;
            }
            continue;
         }
         CoalesceStep::Collect(timeout) if timeout.is_zero() => match receiver.try_recv() {
            Ok(event) => Some(event),
            Err(TryRecvError::Empty) => {
               if !flush(&mut coalescer, &mut emit) {
                  return;
               }
               continue;
            }
            Err(TryRecvError::Disconnected) => None,
         },
         CoalesceStep::Collect(timeout) => match receiver.recv_timeout(timeout) {
            Ok(event) => Some(event),
            Err(RecvTimeoutError::Timeout) => {
               if !flush(&mut coalescer, &mut emit) {
                  return;
               }
               continue;
            }
            Err(RecvTimeoutError::Disconnected) => None,
         },
      };

      match next {
         Some(TerminalEvent::Output { data }) => {
            if coalescer.would_overflow(data.len()) && !flush(&mut coalescer, &mut emit) {
               return;
            }
            coalescer.push(data, Instant::now());
         }
         Some(event) => {
            if !flush(&mut coalescer, &mut emit) || !emit(event) {
               return;
            }
         }
         None => {
            flush(&mut coalescer, &mut emit);
            return;
         }
      }
   }
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::{
      sync::{Arc, mpsc},
      thread,
   };

   fn config() -> CoalesceConfig {
      CoalesceConfig {
         max_delay: Duration::from_millis(4),
         burst_gap: Duration::from_millis(1),
         max_bytes: 16,
      }
   }

   fn ms(value: u64) -> Duration {
      Duration::from_millis(value)
   }

   fn us(value: u64) -> Duration {
      Duration::from_micros(value)
   }

   fn output(data: &[u8]) -> TerminalEvent {
      TerminalEvent::Output {
         data: data.to_vec(),
      }
   }

   fn describe(event: &TerminalEvent) -> String {
      match event {
         TerminalEvent::Output { data } => format!("output:{}", String::from_utf8_lossy(data)),
         TerminalEvent::Error { message } => format!("error:{message}"),
         TerminalEvent::Exit { exit_code, .. } => format!("exit:{exit_code:?}"),
         TerminalEvent::Closed => "closed".to_string(),
      }
   }

   #[test]
   fn idle_without_pending_output() {
      let coalescer = OutputCoalescer::new(config());
      assert_eq!(coalescer.next_step(Instant::now()), CoalesceStep::Idle);
   }

   #[test]
   fn first_chunk_after_quiet_period_only_takes_queued_output() {
      let start = Instant::now();
      let mut coalescer = OutputCoalescer::new(config());
      coalescer.push(b"a".to_vec(), start);

      assert_eq!(
         coalescer.next_step(start),
         CoalesceStep::Collect(Duration::ZERO)
      );
      assert_eq!(coalescer.take(start), Some(b"a".to_vec()));
      assert_eq!(coalescer.next_step(start), CoalesceStep::Idle);

      coalescer.push(b"b".to_vec(), start + ms(50));
      assert_eq!(
         coalescer.next_step(start + ms(50)),
         CoalesceStep::Collect(Duration::ZERO)
      );
   }

   #[test]
   fn output_right_after_a_flush_waits_for_more() {
      let start = Instant::now();
      let mut coalescer = OutputCoalescer::new(config());
      coalescer.push(b"a".to_vec(), start);
      coalescer.take(start);

      coalescer.push(b"b".to_vec(), start + us(200));
      assert_eq!(
         coalescer.next_step(start + us(200)),
         CoalesceStep::Collect(ms(1))
      );
      coalescer.push(b"c".to_vec(), start + us(700));
      assert_eq!(
         coalescer.next_step(start + us(900)),
         CoalesceStep::Collect(us(800))
      );
      assert_eq!(coalescer.take(start + ms(2)), Some(b"bc".to_vec()));
   }

   #[test]
   fn streaming_batch_flushes_once_output_goes_quiet() {
      let start = Instant::now();
      let mut coalescer = OutputCoalescer::new(config());
      coalescer.push(b"a".to_vec(), start);
      coalescer.take(start);
      coalescer.push(b"b".to_vec(), start);

      assert_eq!(coalescer.next_step(start + ms(1)), CoalesceStep::Flush);
   }

   #[test]
   fn streaming_batch_never_waits_past_max_delay() {
      let start = Instant::now();
      let mut coalescer = OutputCoalescer::new(config());
      coalescer.push(b"a".to_vec(), start);
      coalescer.take(start);

      for step in 0..5 {
         coalescer.push(b"x".to_vec(), start + us(900 * step));
      }
      assert_eq!(
         coalescer.next_step(start + us(3600)),
         CoalesceStep::Collect(us(400))
      );
      assert_eq!(coalescer.next_step(start + ms(4)), CoalesceStep::Flush);
   }

   #[test]
   fn full_batch_flushes_immediately() {
      let start = Instant::now();
      let mut coalescer = OutputCoalescer::new(config());
      coalescer.push(vec![b'a'; 10], start);
      coalescer.push(vec![b'b'; 6], start);

      assert_eq!(coalescer.next_step(start), CoalesceStep::Flush);
      assert_eq!(coalescer.take(start).map(|data| data.len()), Some(16));
   }

   #[test]
   fn empty_chunks_do_not_start_a_batch() {
      let start = Instant::now();
      let mut coalescer = OutputCoalescer::new(config());
      coalescer.push(Vec::new(), start);

      assert_eq!(coalescer.next_step(start), CoalesceStep::Idle);
      assert_eq!(coalescer.take(start), None);
   }

   #[test]
   fn forwarding_merges_queued_output_and_keeps_event_order() {
      let (sender, receiver) = mpsc::channel();
      sender.send(output(b"one ")).unwrap();
      sender.send(output(b"two")).unwrap();
      sender
         .send(TerminalEvent::Exit {
            exit_code: Some(0),
            signal: None,
         })
         .unwrap();
      sender.send(output(b"late")).unwrap();
      sender.send(TerminalEvent::Closed).unwrap();
      drop(sender);

      let mut emitted = Vec::new();
      forward_coalesced(
         &receiver,
         &TerminalReaderControl::default(),
         config(),
         |event| {
            emitted.push(describe(&event));
            true
         },
      );

      assert_eq!(
         emitted,
         vec!["output:one two", "exit:Some(0)", "output:late", "closed"]
      );
   }

   #[test]
   fn forwarding_never_grows_a_batch_past_the_size_cap() {
      let (sender, receiver) = mpsc::channel();
      for _ in 0..3 {
         sender
            .send(TerminalEvent::Output {
               data: vec![b'x'; 6],
            })
            .unwrap();
      }
      drop(sender);

      let mut sizes = Vec::new();
      forward_coalesced(
         &receiver,
         &TerminalReaderControl::default(),
         config(),
         |event| {
            if let TerminalEvent::Output { data } = event {
               sizes.push(data.len());
            }
            true
         },
      );

      assert_eq!(sizes, vec![12, 6]);
   }

   #[test]
   fn forwarding_sends_a_lone_chunk_without_waiting_for_more() {
      let (sender, receiver) = mpsc::channel();
      let (emitted_sender, emitted) = mpsc::channel();
      let forwarder = thread::spawn(move || {
         forward_coalesced(
            &receiver,
            &TerminalReaderControl::default(),
            CoalesceConfig::default(),
            |event| emitted_sender.send(describe(&event)).is_ok(),
         );
      });

      sender.send(output(b"echo")).unwrap();
      assert_eq!(
         emitted.recv_timeout(Duration::from_secs(5)).unwrap(),
         "output:echo"
      );

      drop(sender);
      forwarder.join().unwrap();
   }

   #[test]
   fn forwarding_stops_when_the_receiver_is_gone() {
      let (sender, receiver) = mpsc::channel();
      sender.send(output(b"a")).unwrap();
      sender.send(TerminalEvent::Closed).unwrap();

      let mut calls = 0;
      forward_coalesced(
         &receiver,
         &TerminalReaderControl::default(),
         config(),
         |_| {
            calls += 1;
            false
         },
      );

      assert_eq!(calls, 1);
      drop(receiver);
      assert!(sender.send(output(b"b")).is_err());
   }

   #[test]
   fn forwarding_holds_output_while_paused() {
      let control = Arc::new(TerminalReaderControl::default());
      control.set_paused(true);
      let (sender, receiver) = mpsc::channel();
      let (emitted_sender, emitted) = mpsc::channel();
      let forward_control = control.clone();
      let forwarder = thread::spawn(move || {
         forward_coalesced(&receiver, &forward_control, config(), |event| {
            emitted_sender.send(describe(&event)).is_ok()
         });
      });

      sender.send(output(b"held")).unwrap();
      assert!(emitted.recv_timeout(ms(50)).is_err());

      control.set_paused(false);
      assert_eq!(emitted.recv_timeout(ms(5000)).unwrap(), "output:held");
      drop(sender);
      forwarder.join().unwrap();
   }

   #[test]
   fn forwarding_sends_nothing_more_after_a_pause_until_resumed() {
      let control = Arc::new(TerminalReaderControl::default());
      let (sender, receiver) = mpsc::channel();
      for chunk in [b"aaaaaaaaaa", b"bbbbbbbbbb", b"cccccccccc"] {
         sender.send(output(chunk)).unwrap();
      }
      sender
         .send(TerminalEvent::Exit {
            exit_code: Some(0),
            signal: None,
         })
         .unwrap();
      sender.send(TerminalEvent::Closed).unwrap();
      drop(sender);

      let (emitted_sender, emitted) = mpsc::channel();
      let forward_control = control.clone();
      let frontend_control = control.clone();
      let forwarder = thread::spawn(move || {
         forward_coalesced(&receiver, &forward_control, config(), |event| {
            // The frontend asks for a pause as soon as each batch lands.
            frontend_control.set_paused(true);
            emitted_sender.send(describe(&event)).is_ok()
         });
      });

      assert_eq!(emitted.recv_timeout(ms(5000)).unwrap(), "output:aaaaaaaaaa");
      assert!(emitted.recv_timeout(ms(50)).is_err());

      // Resuming (as the frontend or `kill` does) lets the rest drain in order.
      control.set_paused(false);
      assert_eq!(emitted.recv_timeout(ms(5000)).unwrap(), "output:bbbbbbbbbb");
      control.set_paused(false);
      assert_eq!(emitted.recv_timeout(ms(5000)).unwrap(), "output:cccccccccc");
      control.set_paused(false);
      assert_eq!(emitted.recv_timeout(ms(5000)).unwrap(), "exit:Some(0)");
      assert_eq!(emitted.recv_timeout(ms(5000)).unwrap(), "closed");
      forwarder.join().unwrap();
   }
}
