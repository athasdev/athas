//! The files `athas --wait` is waiting on. A marker is released once every file sent with it has
//! been opened and closed again, when one never opens within a grace period, or when Athas quits.

use std::{
    collections::HashSet,
    time::{Duration, Instant},
};

/// How long a file may take to show up in a tab before its wait is given up.
pub const OPEN_GRACE: Duration = Duration::from_secs(15);

struct Wait {
    marker: String,
    path: String,
    seen_open: bool,
    since: Instant,
}

impl Wait {
    fn done(&self, open: &HashSet<String>, now: Instant) -> bool {
        if self.seen_open { !open.contains(&self.path) } else { now.duration_since(self.since) > OPEN_GRACE }
    }
}

#[derive(Default)]
pub struct Waits {
    waits: Vec<Wait>,
}

impl Waits {
    pub fn is_empty(&self) -> bool {
        self.waits.is_empty()
    }

    pub fn track(&mut self, marker: &str, path: &str, now: Instant) {
        self.waits.push(Wait { marker: marker.into(), path: path.into(), seen_open: false, since: now });
    }

    /// Takes the files open now and returns the markers that can be released.
    pub fn update(&mut self, open: &HashSet<String>, now: Instant) -> Vec<String> {
        for wait in &mut self.waits {
            wait.seen_open |= open.contains(&wait.path);
        }
        let mut markers: Vec<String> = Vec::new();
        for wait in &self.waits {
            if !markers.contains(&wait.marker) {
                markers.push(wait.marker.clone());
            }
        }
        let finished: Vec<String> = markers
            .into_iter()
            .filter(|marker| self.waits.iter().filter(|wait| &wait.marker == marker).all(|wait| wait.done(open, now)))
            .collect();
        self.waits.retain(|wait| !finished.contains(&wait.marker));
        finished
    }

    /// Every marker, for when Athas quits.
    pub fn release_all(&mut self) -> Vec<String> {
        let mut markers: Vec<String> = self.waits.drain(..).map(|wait| wait.marker).collect();
        markers.sort();
        markers.dedup();
        markers
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|path| path.to_string()).collect()
    }

    #[test]
    fn a_marker_waits_for_all_its_files_to_close() {
        let start = Instant::now();
        let mut waits = Waits::default();
        waits.track("/tmp/athas-cli-wait/1-1", "/a", start);
        waits.track("/tmp/athas-cli-wait/1-1", "/b", start);
        waits.track("/tmp/athas-cli-wait/2-2", "/c", start);

        assert!(waits.update(&open(&[]), start).is_empty(), "nothing has opened yet");
        assert!(waits.update(&open(&["/a", "/b", "/c"]), start).is_empty());
        assert!(waits.update(&open(&["/b", "/c"]), start).is_empty(), "/b is still open");
        assert_eq!(waits.update(&open(&["/c"]), start), vec!["/tmp/athas-cli-wait/1-1".to_string()]);
        assert_eq!(waits.release_all(), vec!["/tmp/athas-cli-wait/2-2".to_string()]);
        assert!(waits.is_empty());
    }

    #[test]
    fn a_file_that_never_opens_is_given_up() {
        let start = Instant::now();
        let mut waits = Waits::default();
        waits.track("/tmp/athas-cli-wait/1-1", "/a", start);
        assert!(waits.update(&open(&[]), start + OPEN_GRACE / 2).is_empty());
        assert_eq!(waits.update(&open(&[]), start + OPEN_GRACE * 2).len(), 1);
    }
}
