/// The user agent Safari sends on the given macOS major version.
///
/// WKWebView leaves the `Version/… Safari/…` suffix off its default user agent,
/// and many sites treat a WebKit browser without it as outdated or refuse to
/// sign in from it. Safari freezes the OS part of the string, so only its own
/// version follows the system.
pub fn safari_user_agent(macos_major: u64) -> String {
   let safari_major = match macos_major {
      0..=10 => 15,
      11 => 14,
      12 => 15,
      13 => 16,
      14 => 17,
      15 => 18,
      major => major,
   };
   format!(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) \
       Version/{safari_major}.0 Safari/605.1.15"
   )
}

#[cfg(test)]
mod tests {
   use super::*;

   #[test]
   fn matches_the_safari_release_of_each_macos_version() {
      assert!(safari_user_agent(14).contains("Version/17.0 Safari/605.1.15"));
      assert!(safari_user_agent(15).contains("Version/18.0 Safari/605.1.15"));
      assert!(safari_user_agent(26).contains("Version/26.0 Safari/605.1.15"));
      assert!(safari_user_agent(26).starts_with("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"));
   }
}
