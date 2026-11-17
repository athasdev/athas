//! Java class files (`java-class-file.ts`): a definition inside a jar comes back as a `jdt://`
//! address; its decompiled source is asked of the Java server (`java/classFileContents`) and opens
//! as a read-only Java document.

use std::{
    hash::{DefaultHasher, Hash, Hasher},
    path::PathBuf,
};

use gpui::Context;
use lsp_client::lsp;

use crate::{Editor, LspEvent, fs};

enum ClassFileContents {}

impl lsp::request::Request for ClassFileContents {
    type Params = lsp::TextDocumentIdentifier;
    type Result = Option<String>;
    const METHOD: &'static str = "java/classFileContents";
}

pub(crate) fn is_java_class_file_uri(uri: &lsp::Url) -> bool {
    uri.scheme() == "jdt"
}

/// The tab name: the address's last path segment, decoded (`getJavaClassFileName`).
pub(crate) fn java_class_file_name(uri: &str) -> String {
    let path = uri.split('?').next().unwrap_or(uri);
    let encoded = &path[path.rfind('/').map_or(0, |slash| slash + 1)..];
    let decoded = percent_decode(encoded).unwrap_or_else(|| encoded.to_string());
    if decoded.is_empty() { "Java Class".to_string() } else { decoded }
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

impl Editor {
    pub(crate) fn open_java_class_file(&mut self, uri: lsp::Url, range: lsp::Range, cx: &mut Context<Self>) {
        let Some(server) = self.lsp.document.as_ref().map(|document| document.server().clone()) else { return };
        let request = server.request::<ClassFileContents>(lsp::TextDocumentIdentifier { uri: uri.clone() });
        self.lsp.request_task = Some(cx.spawn(async move |this, cx| {
            let response = request.await;
            this.update(cx, |editor, cx| {
                let text = match response {
                    Ok(Some(text)) => text,
                    Ok(None) => String::new(),
                    Err(error) => {
                        editor.notice = Some(format!("Could not open the class file: {error:#}"));
                        cx.notify();
                        return;
                    }
                };
                let name = java_class_file_name(uri.as_str());
                let mut hasher = DefaultHasher::new();
                uri.as_str().hash(&mut hasher);
                let source = PathBuf::from(format!("{}.java", name.trim_end_matches(".class")));
                let path = fs::register_snapshot(&format!("jdt-{:x}", hasher.finish()), &name, &source, text);
                cx.emit(LspEvent::OpenLocation { path, line: range.start.line as usize + 1, column: range.start.character as usize + 1 });
            })
            .ok();
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(java_class_file_name("jdt://contents/rt.jar/java.lang/String.class?=jdk/%3Cjava.lang"), "String.class");
        assert_eq!(java_class_file_name("jdt://contents/a/Outer%24Inner.class"), "Outer$Inner.class");
        assert_eq!(java_class_file_name("jdt://contents/"), "Java Class");
        assert!(is_java_class_file_uri(&lsp::Url::parse("jdt://contents/Foo.class").unwrap()));
        assert!(!is_java_class_file_uri(&lsp::Url::parse("file:///Foo.java").unwrap()));
    }
}
