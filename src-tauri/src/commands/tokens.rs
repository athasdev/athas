use anyhow::Result;
use serde::{Deserialize, Serialize};
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Token {
   pub start: usize,
   pub end: usize,
   pub token_type: String,
   pub class_name: String,
}

// Standard highlight names used by Tree-sitter
const HIGHLIGHT_NAMES: &[&str] = &[
   "attribute",
   "comment",
   "constant",
   "constant.builtin",
   "constructor",
   "embedded",
   "error",
   "function",
   "function.builtin",
   "function.method",
   "keyword",
   "keyword.control",
   "keyword.function",
   "keyword.operator",
   "keyword.return",
   "module",
   "number",
   "operator",
   "property",
   "property.builtin",
   "punctuation",
   "punctuation.bracket",
   "punctuation.delimiter",
   "punctuation.special",
   "string",
   "string.escape",
   "string.special",
   "tag",
   "type",
   "type.builtin",
   "variable",
   "variable.builtin",
   "variable.parameter",
];

fn get_language_config(language_name: &str) -> Result<HighlightConfiguration> {
   match language_name {
      "javascript" | "js" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_javascript::LANGUAGE.into(),
            language_name,
            tree_sitter_javascript::HIGHLIGHT_QUERY,
            tree_sitter_javascript::INJECTIONS_QUERY,
            tree_sitter_javascript::LOCALS_QUERY,
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "typescript" | "ts" => {
         // TypeScript inherits JavaScript highlights, so we use JavaScript's query
         let mut config = HighlightConfiguration::new(
            tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            language_name,
            tree_sitter_javascript::HIGHLIGHT_QUERY,
            tree_sitter_javascript::INJECTIONS_QUERY,
            tree_sitter_javascript::LOCALS_QUERY,
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "tsx" => {
         // TSX also inherits JavaScript highlights
         let mut config = HighlightConfiguration::new(
            tree_sitter_typescript::LANGUAGE_TSX.into(),
            language_name,
            tree_sitter_javascript::HIGHLIGHT_QUERY,
            tree_sitter_javascript::INJECTIONS_QUERY,
            tree_sitter_javascript::LOCALS_QUERY,
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "json" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_json::LANGUAGE.into(),
            language_name,
            tree_sitter_json::HIGHLIGHTS_QUERY,
            "", // JSON doesn't have injections/locals
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "yaml" | "yml" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_yaml::LANGUAGE.into(),
            language_name,
            tree_sitter_yaml::HIGHLIGHTS_QUERY,
            "", // YAML doesn't have injections/locals
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "go" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_go::LANGUAGE.into(),
            language_name,
            tree_sitter_go::HIGHLIGHTS_QUERY,
            "", // Go doesn't have injections/locals in the current version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "ruby" | "rb" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_ruby::LANGUAGE.into(),
            language_name,
            tree_sitter_ruby::HIGHLIGHTS_QUERY,
            "", // Ruby doesn't have injections/locals in this version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "rust" | "rs" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_rust::LANGUAGE.into(),
            language_name,
            tree_sitter_rust::HIGHLIGHTS_QUERY,
            tree_sitter_rust::INJECTIONS_QUERY,
            "", // Rust doesn't have LOCALS_QUERY in this version
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "erb" | "html.erb" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_embedded_template::LANGUAGE.into(),
            language_name,
            tree_sitter_embedded_template::HIGHLIGHTS_QUERY,
            "", // ERB doesn't have injections/locals in this version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "python" | "py" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_python::LANGUAGE.into(),
            language_name,
            tree_sitter_python::HIGHLIGHTS_QUERY,
            "", // Python doesn't have injections/locals in this version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "html" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_html::LANGUAGE.into(),
            language_name,
            tree_sitter_html::HIGHLIGHTS_QUERY,
            tree_sitter_html::INJECTIONS_QUERY,
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "css" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_css::LANGUAGE.into(),
            language_name,
            tree_sitter_css::HIGHLIGHTS_QUERY,
            "", // CSS doesn't have injections/locals
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "markdown" | "md" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_md::LANGUAGE.into(),
            language_name,
            tree_sitter_md::HIGHLIGHT_QUERY_BLOCK,
            tree_sitter_md::INJECTION_QUERY_BLOCK,
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "bash" | "sh" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_bash::LANGUAGE.into(),
            language_name,
            tree_sitter_bash::HIGHLIGHT_QUERY,
            "", // Bash doesn't have injections/locals in this version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "toml" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_toml_ng::LANGUAGE.into(),
            language_name,
            tree_sitter_toml_ng::HIGHLIGHTS_QUERY,
            "", // TOML doesn't have injections/locals in this version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "java" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_java::LANGUAGE.into(),
            language_name,
            tree_sitter_java::HIGHLIGHTS_QUERY,
            "", // Java doesn't have injections/locals in this version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "c" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_c::LANGUAGE.into(),
            language_name,
            tree_sitter_c::HIGHLIGHT_QUERY,
            "", // C doesn't have injections/locals in this version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "cpp" | "cxx" | "cc" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_cpp::LANGUAGE.into(),
            language_name,
            tree_sitter_cpp::HIGHLIGHT_QUERY,
            "", // C++ doesn't have injections/locals in this version
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      "php" => {
         let mut config = HighlightConfiguration::new(
            tree_sitter_php::LANGUAGE_PHP.into(),
            language_name,
            tree_sitter_php::HIGHLIGHTS_QUERY,
            tree_sitter_php::INJECTIONS_QUERY,
            "",
         )?;
         config.configure(HIGHLIGHT_NAMES);
         Ok(config)
      }
      _ => anyhow::bail!("Unsupported language: {}", language_name),
   }
}

fn map_highlight_to_class(highlight_name: &str) -> (&str, &str) {
   match highlight_name {
      "keyword" | "keyword.control" | "keyword.function" | "keyword.operator"
      | "keyword.return" => ("keyword", "token-keyword"),
      "string" | "string.escape" | "string.special" => ("string", "token-string"),
      "number" => ("number", "token-number"),
      "constant" | "constant.builtin" => ("constant", "token-constant"),
      "comment" => ("comment", "token-comment"),
      "function" | "function.builtin" | "function.method" => ("function", "token-function"),
      "type" | "type.builtin" => ("type", "token-type"),
      "variable" | "variable.builtin" | "variable.parameter" => ("identifier", "token-identifier"),
      "property" | "property.builtin" => ("property", "token-property"),
      "operator" => ("operator", "token-operator"),
      "punctuation" | "punctuation.bracket" | "punctuation.delimiter" | "punctuation.special" => {
         ("punctuation", "token-punctuation")
      }
      "tag" => ("jsx", "token-jsx"),
      "attribute" => ("jsx-attribute", "token-jsx-attribute"),
      _ => ("text", "token-text"),
   }
}

#[tauri::command]
pub async fn get_tokens(content: String, file_extension: String) -> Result<Vec<Token>, String> {
   // Determine language from extension
   let language = match file_extension.as_str() {
      "js" | "jsx" => "javascript",
      "ts" => "typescript",
      "tsx" => "tsx",
      "json" => "json",
      "yml" | "yaml" => "yaml",
      "go" => "go",
      "rb" | "ruby" => "ruby",
      "rs" => "rust",
      "erb" | "html.erb" => "erb",
      "py" => "python",
      "html" | "htm" => "html",
      "css" => "css",
      "md" | "markdown" => "markdown",
      "sh" | "bash" => "bash",
      "toml" => "toml",
      "java" => "java",
      "c" => "c",
      "cpp" | "cxx" | "cc" | "c++" | "hpp" | "hxx" | "h++" => "cpp",
      "php" => "php",
      _ => return Err(format!("Unsupported file extension: {}", file_extension)),
   };

   tokenize_content(&content, language).map_err(|e| format!("Failed to tokenize: {e}"))
}

pub fn tokenize_content(content: &str, language: &str) -> Result<Vec<Token>> {
   let config = get_language_config(language)?;
   let mut highlighter = Highlighter::new();

   let highlights = highlighter
      .highlight(&config, content.as_bytes(), None, |_| None)?
      .collect::<Result<Vec<_>, _>>()?;

   let mut tokens = Vec::new();
   let mut current_highlight: Option<usize> = None;

   for event in highlights {
      match event {
         HighlightEvent::Source { start, end } => {
            if let Some(highlight_idx) = current_highlight {
               let highlight_name = HIGHLIGHT_NAMES.get(highlight_idx).unwrap_or(&"text");
               let (token_type, class_name) = map_highlight_to_class(highlight_name);

               // Skip whitespace-only tokens
               let text = &content[start..end];
               if !text.trim().is_empty() {
                  tokens.push(Token {
                     start,
                     end,
                     token_type: token_type.to_string(),
                     class_name: class_name.to_string(),
                  });
               }
            }
         }
         HighlightEvent::HighlightStart(highlight) => {
            current_highlight = Some(highlight.0);
         }
         HighlightEvent::HighlightEnd => {
            current_highlight = None;
         }
      }
   }

   Ok(tokens)
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn test_tokenize_javascript() {
      let code = r#"const greeting = "Hello, world!";
function sayHello(name) {
    console.log(`Hello, ${name}!`);
}
const numbers = [1, 2, 3];
const result = numbers.map(n => n * 2);"#;

      let tokens = tokenize_content(code, "javascript").unwrap();
      println!("Found {} tokens", tokens.len());

      // Print all tokens for debugging
      for (i, token) in tokens.iter().enumerate() {
         let text = &code[token.start..token.end];
         println!("Token {}: {:?} = '{}'", i, token, text);
      }

      // Check for various token types
      let token_types: Vec<&str> = tokens.iter().map(|t| t.token_type.as_str()).collect();
      let unique_types: std::collections::HashSet<&str> =
         tokens.iter().map(|t| t.token_type.as_str()).collect();

      println!("Unique token types: {:?}", unique_types);

      assert!(!tokens.is_empty(), "Should have tokens");
      assert!(
         token_types.contains(&"keyword"),
         "Should have keyword tokens"
      );
      assert!(token_types.contains(&"string"), "Should have string tokens");
      assert!(
         token_types.contains(&"identifier"),
         "Should have identifier tokens"
      );
      assert!(
         token_types.contains(&"function"),
         "Should have function tokens"
      );
      assert!(token_types.contains(&"number"), "Should have number tokens");
      assert!(
         token_types.contains(&"punctuation"),
         "Should have punctuation tokens"
      );
      assert!(
         token_types.contains(&"operator"),
         "Should have operator tokens"
      );
   }

   #[test]
   fn test_tokenize_go() {
      let code = r#"package main

import "fmt"

func main() {
    greeting := "Hello, Go!"
    numbers := []int{1, 2, 3}
    for _, n := range numbers {
        fmt.Printf("Number: %d\n", n)
    }
}"#;

      let tokens = tokenize_content(code, "go").unwrap();
      println!("Found {} tokens", tokens.len());

      // Check for Go-specific token types
      let token_types: Vec<&str> = tokens.iter().map(|t| t.token_type.as_str()).collect();
      assert!(
         token_types.contains(&"keyword"),
         "Should have keyword tokens"
      );
      assert!(token_types.contains(&"string"), "Should have string tokens");
      assert!(
         token_types.contains(&"identifier"),
         "Should have identifier tokens"
      );
      assert!(token_types.contains(&"number"), "Should have number tokens");
   }

   #[test]
   fn test_tokenize_toml() {
      let code = r#"[package]
name = "example"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1.0"

[dev-dependencies]
criterion = "0.5"

[features]
default = ["std"]
std = []"#;

      let tokens = tokenize_content(code, "toml").unwrap();
      println!("Found {} tokens", tokens.len());

      // Check for TOML-specific token types
      let token_types: Vec<&str> = tokens.iter().map(|t| t.token_type.as_str()).collect();
      assert!(!tokens.is_empty(), "Should have tokens");
      assert!(token_types.contains(&"string"), "Should have string tokens");
      assert!(
         token_types.contains(&"punctuation"),
         "Should have punctuation tokens"
      );
   }

   #[test]
   fn test_tokenize_java() {
      let code = r#"public class HelloWorld {
    private String message;
    
    public HelloWorld(String message) {
        this.message = message;
    }
    
    public void greet() {
        System.out.println("Hello, " + message + "!");
    }
    
    public static void main(String[] args) {
        HelloWorld app = new HelloWorld("World");
        app.greet();
    }
}"#;

      let tokens = tokenize_content(code, "java").unwrap();
      println!("Found {} Java tokens", tokens.len());

      let token_types: Vec<&str> = tokens.iter().map(|t| t.token_type.as_str()).collect();
      assert!(token_types.contains(&"keyword"), "Should have keyword tokens");
      assert!(token_types.contains(&"string"), "Should have string tokens");
      assert!(token_types.contains(&"identifier"), "Should have identifier tokens");
      assert!(token_types.contains(&"function"), "Should have function tokens");
   }

   #[test]
   fn test_tokenize_c() {
      let code = r#"#include <stdio.h>

int main() {
    int number = 42;
    printf("Hello, C! Number: %d\n", number);
    return 0;
}"#;

      let tokens = tokenize_content(code, "c").unwrap();
      println!("Found {} C tokens", tokens.len());

      let token_types: Vec<&str> = tokens.iter().map(|t| t.token_type.as_str()).collect();
      assert!(token_types.contains(&"keyword"), "Should have keyword tokens");
      assert!(token_types.contains(&"string"), "Should have string tokens");
      assert!(token_types.contains(&"identifier"), "Should have identifier tokens");
      assert!(token_types.contains(&"number"), "Should have number tokens");
   }

   #[test]
   fn test_tokenize_cpp() {
      let code = r#"#include <iostream>
#include <string>

class Greeter {
private:
    std::string name;
    
public:
    Greeter(const std::string& n) : name(n) {}
    
    void greet() const {
        std::cout << "Hello, " << name << "!" << std::endl;
    }
};

int main() {
    Greeter g("World");
    g.greet();
    return 0;
}"#;

      let tokens = tokenize_content(code, "cpp").unwrap();
      println!("Found {} C++ tokens", tokens.len());

      let token_types: Vec<&str> = tokens.iter().map(|t| t.token_type.as_str()).collect();
      assert!(!tokens.is_empty(), "Should have tokens");
      assert!(token_types.contains(&"keyword"), "Should have keyword tokens");
      assert!(token_types.contains(&"function") || token_types.contains(&"identifier"), "Should have function or identifier tokens");
   }

   #[test]
   fn test_tokenize_php() {
      let code = r#"<?php
class User {
    private $name;
    private $email;
    
    public function __construct($name, $email) {
        $this->name = $name;
        $this->email = $email;
    }
    
    public function greet() {
        echo "Hello, {$this->name}! Your email is {$this->email}";
    }
}

$user = new User("Alice", "alice@example.com");
$user->greet();
?>"#;

      let tokens = tokenize_content(code, "php").unwrap();
      println!("Found {} PHP tokens", tokens.len());

      let token_types: Vec<&str> = tokens.iter().map(|t| t.token_type.as_str()).collect();
      assert!(token_types.contains(&"keyword"), "Should have keyword tokens");
      assert!(token_types.contains(&"string"), "Should have string tokens");
      assert!(token_types.contains(&"identifier"), "Should have identifier tokens");
      assert!(token_types.contains(&"function"), "Should have function tokens");
   }

   #[test]
   fn test_tokenize_ruby() {
      let code = r#"class User
  def initialize(name)
    @name = name
  end

  def greet
    puts "Hello, #{@name}!"
  end

  def self.create_admin
    new("admin")
  end
end

user = User.new("Alice")
user.greet

numbers = [1, 2, 3].map { |n| n * 2 }"#;

      let tokens = tokenize_content(code, "ruby").unwrap();
      println!("Found {} tokens", tokens.len());

      // Check for Ruby-specific token types
      let token_types: Vec<&str> = tokens.iter().map(|t| t.token_type.as_str()).collect();
      assert!(
         token_types.contains(&"keyword"),
         "Should have keyword tokens"
      );
      assert!(token_types.contains(&"string"), "Should have string tokens");
      assert!(
         token_types.contains(&"identifier"),
         "Should have identifier tokens"
      );
      assert!(token_types.contains(&"number"), "Should have number tokens");
   }
}
