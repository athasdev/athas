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

#[test]
#[ignore = "requires an isolated local SSH server and ATHAS_SSH_TEST_PORT, ATHAS_SSH_TEST_USER, \
            ATHAS_SSH_TEST_HOME"]
fn verifies_and_persists_server_trust_before_authentication() {
   let port = std::env::var("ATHAS_SSH_TEST_PORT")
      .unwrap()
      .parse()
      .unwrap();
   let username = std::env::var("ATHAS_SSH_TEST_USER").unwrap();
   let key =
      PathBuf::from(std::env::var("ATHAS_SSH_TEST_HOME").unwrap()).join(".ssh/custom_ed25519");
   let home = tempfile::tempdir().unwrap();
   let connect = |identity: &Path| {
      create_ssh_session_with_config(
         "127.0.0.1",
         port,
         &username,
         None,
         identity.to_str(),
         &SshConfig::default(),
         home.path(),
      )
   };
   let unknown = connect(Path::new("/missing/private-key")).err().unwrap();
   assert!(unknown.starts_with("ATHAS_SSH_UNKNOWN_HOST:"), "{unknown}");
   assert!(!unknown.contains("private-key failed"));
   let session = super::handshake_session("127.0.0.1", port).unwrap();
   assert!(!session.authenticated());
   let details: serde_json::Value =
      serde_json::from_str(unknown.strip_prefix("ATHAS_SSH_UNKNOWN_HOST:").unwrap()).unwrap();
   let fingerprint = details["fingerprint"].as_str().unwrap();
   assert!(
      crate::ssh_host_trust::trust_session(&session, "127.0.0.1", port, home.path(), "wrong-key")
         .is_err()
   );
   assert!(!home.path().join(".ssh/athas_known_hosts").exists());
   crate::ssh_host_trust::trust_session(&session, "127.0.0.1", port, home.path(), fingerprint)
      .unwrap();
   assert!(!session.authenticated());
   let authenticated = connect(&key).unwrap();
   assert!(authenticated.authenticated());
   assert_eq!(
      super::exec_remote_command(&authenticated, "printf verified").unwrap(),
      "verified"
   );
   authenticated.sftp().unwrap();
   let trusted = home.path().join(".ssh/athas_known_hosts");
   let before = std::fs::read_to_string(&trusted).unwrap();
   let name = before.split_whitespace().next().unwrap();
   std::fs::write(&trusted, format!("{name} ssh-ed25519 b3RoZXIta2V5\n")).unwrap();
   let changed = connect(Path::new("/missing/private-key")).err().unwrap();
   assert!(
      changed.contains("Host key verification failed"),
      "{changed}"
   );
   assert!(!changed.contains("private-key failed"));
}
