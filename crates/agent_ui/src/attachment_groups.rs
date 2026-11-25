//! The composer's attachments summed up by kind ("5 files", "3 diffs"), each group opening on its
//! items.
//!
//! Ported from Athas's `utils/composer-attachment-groups.ts`.

use crate::{context_refs::ContextRef, mentions::Attachment};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Files,
    Folders,
    Diffs,
    Images,
    Selections,
    Quotes,
    Terminals,
    GitHub,
    Problems,
    Chats,
    Skills,
    Other,
}

const ORDER: &[Kind] = &[
    Kind::Files,
    Kind::Folders,
    Kind::Diffs,
    Kind::Images,
    Kind::Selections,
    Kind::Quotes,
    Kind::Terminals,
    Kind::GitHub,
    Kind::Problems,
    Kind::Chats,
    Kind::Skills,
    Kind::Other,
];

impl Kind {
    fn nouns(self) -> (&'static str, &'static str) {
        match self {
            Kind::Files => ("file", "files"),
            Kind::Folders => ("folder", "folders"),
            Kind::Diffs => ("diff", "diffs"),
            Kind::Images => ("image", "images"),
            Kind::Selections => ("selection", "selections"),
            Kind::Quotes => ("quote", "quotes"),
            Kind::Terminals => ("terminal", "terminals"),
            Kind::GitHub => ("GitHub item", "GitHub items"),
            Kind::Problems => ("problem list", "problem lists"),
            Kind::Chats => ("past chat", "past chats"),
            Kind::Skills => ("skill", "skills"),
            Kind::Other => ("resource", "resources"),
        }
    }
}

fn is_image_path(path: &std::path::Path) -> bool {
    path.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| {
        matches!(extension.to_ascii_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "bmp" | "ico" | "svg")
    })
}

pub fn kind(attachment: &Attachment) -> Kind {
    match attachment {
        Attachment::File(path) if is_image_path(path) => Kind::Images,
        Attachment::File(_) => Kind::Files,
        Attachment::Session { .. } => Kind::Chats,
        Attachment::Image { .. } => Kind::Images,
        Attachment::Skill { .. } => Kind::Skills,
        Attachment::Context { reference, .. } => match reference {
            ContextRef::Folder(_) => Kind::Folders,
            ContextRef::GitDiff { .. } => Kind::Diffs,
            ContextRef::Problems => Kind::Problems,
            ContextRef::Selection { .. } => Kind::Selections,
            ContextRef::Quote { .. } => Kind::Quotes,
            reference if reference.is_github() => Kind::GitHub,
            ContextRef::Tab { path: Some(path), .. } if is_image_path(path) => Kind::Images,
            ContextRef::Tab { path: Some(_), .. } => Kind::Files,
            ContextRef::Tab { kind, .. } => match kind.as_deref() {
                Some("terminal") => Kind::Terminals,
                Some("diff" | "git-diff") => Kind::Diffs,
                _ => Kind::Other,
            },
        },
    }
}

/// A file attached twice, once from its tab and once from the project, counts once.
fn key(attachment: &Attachment) -> String {
    match attachment {
        Attachment::File(path) | Attachment::Context { reference: ContextRef::Tab { path: Some(path), .. }, .. } => format!("path:{}", path.display()),
        other => format!("{:?}:{}", kind(other), other.label()),
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Group {
    pub kind: Kind,
    /// Each item's attachment indices: more than one when the same file came twice.
    pub items: Vec<Vec<usize>>,
    pub noun: &'static str,
    pub label: String,
}

pub fn groups(attachments: &[Attachment]) -> Vec<Group> {
    let mut entries: Vec<(String, Kind, Vec<usize>)> = Vec::new();
    for (index, attachment) in attachments.iter().enumerate() {
        let key = key(attachment);
        match entries.iter_mut().find(|entry| entry.0 == key) {
            Some(entry) => entry.2.push(index),
            None => entries.push((key, kind(attachment), vec![index])),
        }
    }
    ORDER
        .iter()
        .filter_map(|kind| {
            let items: Vec<Vec<usize>> = entries.iter().filter(|entry| entry.1 == *kind).map(|entry| entry.2.clone()).collect();
            if items.is_empty() {
                return None;
            }
            let (one, many) = kind.nouns();
            let noun = if items.len() == 1 { one } else { many };
            Some(Group { kind: *kind, label: format!("{} {noun}", items.len()), items, noun })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diff(staged: bool) -> Attachment {
        Attachment::Context { reference: ContextRef::GitDiff { staged }, label: String::new(), content: String::new() }
    }

    #[test]
    fn sums_files_and_diffs_separately() {
        let mut attachments: Vec<Attachment> = ["/a.ts", "/b.ts", "/c.ts", "/d.ts", "/e.ts"].iter().map(|path| Attachment::File(path.into())).collect();
        attachments.push(diff(true));
        attachments.push(diff(false));
        let labels: Vec<String> = groups(&attachments).into_iter().map(|group| group.label).collect();
        assert_eq!(labels, ["5 files", "2 diffs"]);
    }

    #[test]
    fn counts_a_file_from_its_tab_and_the_project_once() {
        let tab = Attachment::Context {
            reference: ContextRef::Tab { title: "app.ts".into(), path: Some("/project/app.ts".into()), kind: None, id: None },
            label: String::new(),
            content: String::new(),
        };
        let attachments = vec![tab, Attachment::File("/project/app.ts".into()), Attachment::File("/project/shot.png".into())];
        let groups = groups(&attachments);
        assert_eq!(groups[0].label, "1 file");
        assert_eq!(groups[0].items, vec![vec![0, 1]]);
        assert_eq!(groups[1].label, "1 image");
    }
}
