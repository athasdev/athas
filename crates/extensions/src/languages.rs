//! Languages extensions define: which files they cover, and the language server, formatter and
//! linter that serve them.

use std::path::Path;

use crate::manifest::{ExtensionManifest, ToolDescriptor};

#[derive(Clone, Debug, PartialEq)]
pub struct LanguageDefinition {
    pub id: String,
    pub extension_id: String,
    pub aliases: Vec<String>,
    /// Lowercase, with the dot: `.rs`.
    pub file_extensions: Vec<String>,
    /// Whole file names: `Dockerfile`, `go.mod`.
    pub filenames: Vec<String>,
    pub tools: LanguageTools,
}

/// The tools a language extension declares; installing and running them is the caller's work.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LanguageTools {
    pub lsp: Option<ToolDescriptor>,
    pub formatter: Option<ToolDescriptor>,
    pub linter: Option<ToolDescriptor>,
}

impl LanguageDefinition {
    pub fn from_manifest(manifest: &ExtensionManifest) -> Vec<LanguageDefinition> {
        let tools = LanguageTools {
            lsp: manifest.capabilities.lsp.clone(),
            formatter: manifest.capabilities.formatter.clone(),
            linter: manifest.capabilities.linter.clone(),
        };
        manifest
            .languages()
            .map(|language| LanguageDefinition {
                id: language.id.clone(),
                extension_id: manifest.id.clone(),
                aliases: language.aliases.clone(),
                file_extensions: language
                    .extensions
                    .iter()
                    .map(|extension| {
                        let extension = extension.to_lowercase();
                        if extension.starts_with('.') { extension } else { format!(".{extension}") }
                    })
                    .collect(),
                filenames: language.filenames.clone(),
                tools: tools.clone(),
            })
            .collect()
    }

    /// How well this language claims `file_name`: a whole-name match beats the longest
    /// extension.
    fn match_length(&self, file_name: &str) -> Option<usize> {
        if self.filenames.iter().any(|candidate| candidate.eq_ignore_ascii_case(file_name)) {
            return Some(usize::MAX);
        }
        let lower = file_name.to_lowercase();
        self.file_extensions
            .iter()
            .filter(|extension| lower.len() > extension.len() && lower.ends_with(extension.as_str()))
            .map(String::len)
            .max()
    }
}

/// The language whose file names or extensions match `path` best.
pub fn language_for_path<'a>(languages: &'a [LanguageDefinition], path: &Path) -> Option<&'a LanguageDefinition> {
    let file_name = path.file_name()?.to_str()?;
    languages
        .iter()
        .filter_map(|language| Some((language.match_length(file_name)?, language)))
        .max_by_key(|(length, _)| *length)
        .map(|(_, language)| language)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::Catalog;

    fn all_languages() -> Vec<LanguageDefinition> {
        Catalog::bundled().entries().iter().flat_map(|entry| LanguageDefinition::from_manifest(&entry.manifest)).collect()
    }

    #[test]
    fn maps_files_to_languages() {
        let languages = all_languages();
        let id = |path: &str| language_for_path(&languages, Path::new(path)).map(|language| language.id.as_str());
        assert_eq!(id("/src/main.rs"), Some("rust"));
        assert_eq!(id("App.tsx"), Some("typescriptreact"));
        assert_eq!(id("index.TS"), Some("typescript"));
        assert_eq!(id("Dockerfile"), Some("dockerfile"));
        assert_eq!(id("go.mod"), Some("go"));
        assert_eq!(id(".bashrc"), Some("bash"));
        assert_eq!(id("notes.unknownext"), None);
    }

    #[test]
    fn exposes_tool_descriptors() {
        let languages = all_languages();
        let rust = languages.iter().find(|language| language.id == "rust").unwrap();
        assert_eq!(rust.tools.lsp.as_ref().unwrap().name, "rust-analyzer");
        let typescript = languages.iter().find(|language| language.id == "typescript").unwrap();
        assert_eq!(typescript.tools.formatter.as_ref().unwrap().name, "prettier");
        assert_eq!(typescript.tools.linter.as_ref().unwrap().args[0], "--stdin");
    }
}
