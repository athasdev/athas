use super::{SshConfig, create_ssh_session_with_config, expand_identity_path};
use std::path::{Path, PathBuf};

#[test]
fn expands_home_relative_identity_paths() {
   let home = Path::new("/home/ssh-user");
   assert_eq!(
      expand_identity_path("~/.ssh/custom_ed25519", home),
      home.join(".ssh/custom_ed25519")
   );
   assert_eq!(expand_identity_path("~", home), home);
}

#[test]
fn preserves_absolute_relative_and_named_user_paths() {
   for path in [
      "/keys/id_ed25519",
      ".ssh/id_ed25519",
      "~other/.ssh/id_ed25519",
   ] {
      assert_eq!(
         expand_identity_path(path, Path::new("/home/test")),
         PathBuf::from(path)
      );
   }
}

#[test]
fn handshake_failure_reports_endpoint_and_stage_without_reading_keys() {
   let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
   let port = listener.local_addr().unwrap().port();
   let server = std::thread::spawn(move || {
      let (connection, _) = listener.accept().unwrap();
      connection.shutdown(std::net::Shutdown::Both).unwrap();
   });
   let error = create_ssh_session_with_config(
      "127.0.0.1",
      port,
      "test",
      None,
      Some("/missing/key"),
      &SshConfig::default(),
      Path::new(""),
   )
   .err()
   .expect("a closed socket must fail the handshake");
   server.join().unwrap();
   assert!(error.contains(&format!("127.0.0.1:{port}")), "{error}");
   assert!(error.contains("before authentication"), "{error}");
   assert!(
      error.contains("No private key has been read yet"),
      "{error}"
   );
}

fn connect_to_test_server(key: &str) -> Result<ssh2::Session, String> {
   let port = std::env::var("ATHAS_SSH_TEST_PORT")
      .unwrap()
      .parse()
      .unwrap();
   let username = std::env::var("ATHAS_SSH_TEST_USER").unwrap();
   let test_home = std::env::var("ATHAS_SSH_TEST_HOME").unwrap();
   create_ssh_session_with_config(
      "127.0.0.1",
      port,
      &username,
      None,
      Some(key),
      &SshConfig::default(),
      Path::new(&test_home),
   )
}

#[test]
#[ignore = "requires an isolated local SSH server and ATHAS_SSH_TEST_PORT, ATHAS_SSH_TEST_USER, \
            ATHAS_SSH_TEST_HOME"]
fn authenticates_with_home_relative_openssh_identity() {
   let session = connect_to_test_server("~/.ssh/custom_ed25519").unwrap();
   assert!(session.authenticated());
   assert_eq!(
      super::exec_remote_command(&session, "printf athas-ssh-ok").unwrap(),
      "athas-ssh-ok"
   );
   session
      .sftp()
      .expect("SFTP should work after key authentication");
}

#[test]
#[ignore = "requires an isolated local SSH server and ATHAS_SSH_TEST_PORT, ATHAS_SSH_TEST_USER, \
            ATHAS_SSH_TEST_HOME"]
fn reports_configured_key_failure() {
   let error = connect_to_test_server("~/.ssh/missing_ed25519")
      .err()
      .expect("a missing key must fail authentication");
   assert!(error.contains("missing_ed25519 failed:"), "{error}");
   assert!(
      error.contains("SSH agent authentication failed:"),
      "{error}"
   );
}
