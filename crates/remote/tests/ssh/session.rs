use super::expand_identity_path;
use std::path::{Path, PathBuf};

#[test]
fn expands_home_relative_identity_paths() {
   let home_dir = Path::new("/home/ssh-user");
   assert_eq!(
      expand_identity_path("~/.ssh/custom_ed25519", home_dir),
      home_dir.join(".ssh/custom_ed25519")
   );
   assert_eq!(expand_identity_path("~", home_dir), home_dir);
}

#[test]
fn preserves_absolute_relative_and_named_user_paths() {
   for key_path in [
      "/keys/id_ed25519",
      ".ssh/id_ed25519",
      "~other/.ssh/id_ed25519",
   ] {
      assert_eq!(
         expand_identity_path(key_path, Path::new("/home/ssh-user")),
         PathBuf::from(key_path)
      );
   }
}

#[test]
fn handshake_failure_reports_endpoint_and_stage() {
   let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
   let port = listener.local_addr().unwrap().port();
   let server = std::thread::spawn(move || {
      let (connection, _) = listener.accept().unwrap();
      connection.shutdown(std::net::Shutdown::Both).unwrap();
   });
   let error = super::create_ssh_session("127.0.0.1", port, "test", None, None)
      .err()
      .expect("a closed socket must fail the handshake");
   server.join().unwrap();
   assert!(error.contains(&format!("127.0.0.1:{}", port)), "{error}");
   assert!(error.contains("before authentication"), "{error}");
   assert!(
      error.contains("No private key has been read yet"),
      "{error}"
   );
}

#[test]
#[ignore = "requires a local SSH server and ATHAS_SSH_TEST_PORT, ATHAS_SSH_TEST_USER, \
            ATHAS_SSH_TEST_KEY"]
fn authenticates_with_openssh_identity() {
   let port = std::env::var("ATHAS_SSH_TEST_PORT")
      .unwrap()
      .parse()
      .unwrap();
   let username = std::env::var("ATHAS_SSH_TEST_USER").unwrap();
   let key_path = std::env::var("ATHAS_SSH_TEST_KEY").unwrap();
   let session = super::create_ssh_session("127.0.0.1", port, &username, None, Some(&key_path))
      .unwrap_or_else(|error| panic!("{error}"));
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
#[ignore = "requires a local SSH server and ATHAS_SSH_TEST_PORT, ATHAS_SSH_TEST_USER, \
            ATHAS_SSH_TEST_KEY"]
fn reports_configured_key_failure() {
   let port = std::env::var("ATHAS_SSH_TEST_PORT")
      .unwrap()
      .parse()
      .unwrap();
   let username = std::env::var("ATHAS_SSH_TEST_USER").unwrap();
   let missing_key_path = format!("{}.missing", std::env::var("ATHAS_SSH_TEST_KEY").unwrap());
   let error =
      super::create_ssh_session("127.0.0.1", port, &username, None, Some(&missing_key_path))
         .err()
         .expect("a missing key must fail authentication on the isolated test server");
   assert!(error.contains(".missing failed:"), "{error}");
   assert!(
      error.contains("SSH agent authentication failed:"),
      "{error}"
   );
}
