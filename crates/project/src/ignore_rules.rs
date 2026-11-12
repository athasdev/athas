//! Ignore rules in gitignore syntax. [`IgnoreScope`] compiles one directory's rules and matches
//! paths against them, and rule sets such as [`GitIgnoreRules`] decide how their scopes combine.

mod git;
mod scope;

pub use git::{GitIgnoreRules, is_ignore_file};
pub use scope::{IgnoreScope, IgnoreScopeBuilder, ScopeMatch};
