//! Undo for the tree's own file operations (`file-operation-undo.ts`): moving to the Trash and
//! renames and moves.

use std::path::PathBuf;

const MAX_UNDO_ENTRIES: usize = 50;

/// An item one delete moved to the Trash, and where it landed when the platform said.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Trashed {
    pub original: PathBuf,
    pub trashed: Option<PathBuf>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum FileOperation {
    /// Every entry one delete moved to the Trash, put back together.
    Trash(Vec<Trashed>),
    Move { from: PathBuf, to: PathBuf },
}

#[derive(Default)]
pub(crate) struct UndoStack(Vec<FileOperation>);

impl UndoStack {
    pub fn record(&mut self, operation: FileOperation) {
        if matches!(&operation, FileOperation::Trash(entries) if entries.is_empty()) {
            return;
        }
        self.0.push(operation);
        if self.0.len() > MAX_UNDO_ENTRIES {
            self.0.remove(0);
        }
    }

    pub fn take_last(&mut self) -> Option<FileOperation> {
        self.0.pop()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn moved(from: &str, to: &str) -> FileOperation {
        FileOperation::Move { from: from.into(), to: to.into() }
    }

    #[test]
    fn undoes_the_newest_first_and_keeps_fifty() {
        let mut stack = UndoStack::default();
        for index in 0..60 {
            stack.record(moved(&format!("/a{index}"), &format!("/b{index}")));
        }
        stack.record(FileOperation::Trash(Vec::new()));
        assert_eq!(stack.take_last(), Some(moved("/a59", "/b59")));
        let mut count = 1;
        let mut last = None;
        while let Some(operation) = stack.take_last() {
            count += 1;
            last = Some(operation);
        }
        assert_eq!(count, 50);
        assert_eq!(last, Some(moved("/a10", "/b10")));
    }
}
