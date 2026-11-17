//! Go Back and Go Forward over the places jumps left (`stores/jump-list.store.ts`): a jump to
//! another file records where the caret was, and going back records where it is now so Go
//! Forward can return.

const MAX_ENTRIES: usize = 100;
/// A jump this few lines from the last recorded place in the same file replaces it.
const NEARBY_LINES: usize = 5;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct JumpEntry {
    pub path: String,
    /// 1-based.
    pub line: usize,
    pub column: usize,
}

#[derive(Debug, Default)]
pub(crate) struct JumpList {
    entries: Vec<JumpEntry>,
    /// Where history navigation stands; `None` at the present.
    current: Option<usize>,
}

impl JumpList {
    pub fn push(&mut self, entry: JumpEntry) {
        if let Some(current) = self.current {
            self.entries.truncate(current + 1);
        }
        self.current = None;
        if let Some(last) = self.entries.last_mut()
            && last.path == entry.path
            && last.line.abs_diff(entry.line) <= NEARBY_LINES
        {
            *last = entry;
            return;
        }
        self.entries.push(entry);
        if self.entries.len() > MAX_ENTRIES {
            self.entries.remove(0);
        }
    }

    pub fn go_back(&mut self, here: Option<JumpEntry>) -> Option<JumpEntry> {
        if self.entries.is_empty() {
            return None;
        }
        let index = match self.current {
            None => match here {
                // From a place that is noted first, back is the entry before it.
                Some(here) => {
                    self.entries.push(here);
                    if self.entries.len() > MAX_ENTRIES {
                        self.entries.remove(0);
                    }
                    self.entries.len().checked_sub(2)?
                }
                // From a tab that is no place (a chat), back is the newest entry.
                None => self.entries.len() - 1,
            },
            Some(current) if current > 0 => current - 1,
            Some(_) => return None,
        };
        self.current = Some(index);
        self.entries.get(index).cloned()
    }

    pub fn go_forward(&mut self) -> Option<JumpEntry> {
        let current = self.current?;
        let index = current + 1;
        let entry = self.entries.get(index).cloned()?;
        self.current = Some(index);
        Some(entry)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(path: &str, line: usize) -> JumpEntry {
        JumpEntry { path: path.into(), line, column: 1 }
    }

    #[test]
    fn back_and_forward_walk_the_jumps() {
        let mut list = JumpList::default();
        assert_eq!(list.go_back(Some(at("a", 1))), None);
        list.push(at("a", 10));
        list.push(at("b", 40));
        assert_eq!(list.go_back(Some(at("c", 3))), Some(at("b", 40)));
        assert_eq!(list.go_back(None), Some(at("a", 10)));
        assert_eq!(list.go_back(None), None);
        assert_eq!(list.go_forward(), Some(at("b", 40)));
        assert_eq!(list.go_forward(), Some(at("c", 3)));
        assert_eq!(list.go_forward(), None);
    }

    #[test]
    fn nearby_jumps_replace_and_new_ones_drop_the_future() {
        let mut list = JumpList::default();
        list.push(at("a", 10));
        list.push(at("a", 13));
        list.push(at("b", 1));
        assert_eq!(list.go_back(Some(at("c", 1))), Some(at("b", 1)));
        assert_eq!(list.go_back(None), Some(at("a", 13)));
        list.push(at("d", 5));
        assert_eq!(list.go_forward(), None);
        assert_eq!(list.go_back(Some(at("e", 1))), Some(at("d", 5)));
        assert_eq!(list.go_back(None), Some(at("a", 13)));
    }
}
