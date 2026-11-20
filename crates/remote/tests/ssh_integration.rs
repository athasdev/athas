//! Talks to an SSH server already running on this machine (port 22). Skips when there is none: the
//! test never turns on Remote Login, and never trusts a host or writes under `~/.ssh`.

use std::{net::TcpStream, time::Duration};

use remote::{HostKeyChallenge, PasswordRequired, SavedConnection, session};

#[test]
#[ignore = "reads ~/.ssh and the SSH agent; run with --ignored"]
fn connects_to_a_local_sshd_when_one_runs() {
    let address = "127.0.0.1:22".parse().unwrap();
    if TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_err() {
        eprintln!("skipped: no SSH server on localhost:22");
        return;
    }
    let connection = SavedConnection::for_config_host("127.0.0.1");
    let target = session::Target::resolve(&connection);
    match session::connect(&target, None) {
        Ok(connected) => {
            let output = session::exec(&connected.session, "printf athas", None).unwrap();
            assert_eq!(output.into_result().unwrap(), "athas");
        }
        Err(error) => {
            // An unknown server or a server that wants a password are both expected answers.
            let expected = error.downcast_ref::<HostKeyChallenge>().is_some()
                || error.downcast_ref::<PasswordRequired>().is_some()
                || error.to_string().contains("No valid authentication");
            assert!(expected, "{error:#}");
        }
    }
}
