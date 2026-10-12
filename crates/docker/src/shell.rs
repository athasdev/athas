/// Single-quotes `value` for a POSIX shell.
pub(crate) fn shell_quote(value: &str) -> String {
   format!("'{}'", value.replace('\'', "'\\''"))
}

/// Quotes and joins the non-blank `values` into one shell command line.
pub(crate) fn shell_join(values: impl IntoIterator<Item = String>) -> String {
   values
      .into_iter()
      .filter(|value| !value.trim().is_empty())
      .map(|value| shell_quote(&value))
      .collect::<Vec<_>>()
      .join(" ")
}

/// Prefixes `command` with `export KEY='value'` for each `KEY=value` entry and a `cd` into
/// `workdir`.
pub(crate) fn shell_command_with_context(
   command: &str,
   workdir: Option<&str>,
   remote_env: &[String],
) -> String {
   let mut parts = remote_env
      .iter()
      .filter_map(|entry| entry.split_once('='))
      .map(|(key, value)| format!("export {}={}", key, shell_quote(value)))
      .collect::<Vec<_>>();
   if let Some(workdir) = workdir.filter(|workdir| !workdir.trim().is_empty()) {
      parts.push(format!("cd {}", shell_quote(workdir)));
   }
   parts.push(command.to_string());
   parts.join(" && ")
}

/// Splits a command line into arguments the way a POSIX shell would, without expansion.
pub(crate) fn split_command_args(command: &str) -> Result<Vec<String>, String> {
   let mut args = Vec::new();
   let mut current = String::new();
   let mut chars = command.chars().peekable();
   let mut quote: Option<char> = None;
   let mut arg_started = false;

   while let Some(ch) = chars.next() {
      match ch {
         '\\' if quote != Some('\'') => {
            let Some(next) = chars.next() else {
               return Err("Docker command ends with a dangling escape.".to_string());
            };
            current.push(next);
            arg_started = true;
         }
         '\'' | '"' if quote == Some(ch) => {
            quote = None;
            arg_started = true;
         }
         '\'' | '"' if quote.is_none() => {
            quote = Some(ch);
            arg_started = true;
         }
         ch if ch.is_whitespace() && quote.is_none() => {
            if arg_started {
               args.push(std::mem::take(&mut current));
               arg_started = false;
            }
         }
         _ => {
            current.push(ch);
            arg_started = true;
         }
      }
   }

   if let Some(quote) = quote {
      return Err(format!(
         "Docker command has an unterminated {} quote.",
         quote
      ));
   }
   if arg_started {
      args.push(current);
   }

   Ok(args)
}

/// Lowercase ASCII slug of at most 48 characters, suitable for container and image names.
pub(crate) fn slugify(value: &str) -> String {
   let mut slug = value
      .chars()
      .map(|ch| {
         if ch.is_ascii_alphanumeric() {
            ch.to_ascii_lowercase()
         } else {
            '-'
         }
      })
      .collect::<String>();
   while slug.contains("--") {
      slug = slug.replace("--", "-");
   }
   slug.trim_matches('-').chars().take(48).collect()
}

/// Joins two command outputs with a newline, dropping empty ones.
pub(crate) fn join_command_output(first: String, second: String) -> String {
   [first.trim(), second.trim()]
      .into_iter()
      .filter(|output| !output.is_empty())
      .collect::<Vec<_>>()
      .join("\n")
}
