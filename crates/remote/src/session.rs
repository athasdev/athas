//! Opening an SSH session: `~/.ssh/config` resolution, the TCP (or `ProxyJump`) transport, the
//! host key check, and authentication: key files, then the SSH agent, then a password, every
//! connection trying each in turn. Ported from Athas's `ssh_helpers.rs`.

use std::{
    fmt,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::Child,
    time::Duration,
};

use anyhow::{Context as _, Result, anyhow, bail};
use ssh2::Session;

use crate::{
    connections::SavedConnection,
    known_hosts, ssh_config,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a blocking call on an established session may take before it fails.
const SESSION_TIMEOUT_MS: u32 = 60_000;
const KEEPALIVE_SECONDS: u32 = 15;

/// No key or agent identity was accepted and the server takes passwords: ask for one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PasswordRequired {
    pub user: String,
    pub host: String,
    /// The password given was refused.
    pub rejected: bool,
}

impl fmt::Display for PasswordRequired {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.rejected {
            write!(f, "Permission denied for {}@{}: the password was refused", self.user, self.host)
        } else {
            write!(f, "{}@{} needs a password", self.user, self.host)
        }
    }
}

impl std::error::Error for PasswordRequired {}

/// Where a saved connection really goes once `~/.ssh/config` is applied.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// Tried first, in order: the connection's key, or else the config's `IdentityFile`s
    /// (`key_path.or(identity_file)` in Athas). The default keys in `~/.ssh` follow.
    pub keys: Vec<PathBuf>,
    pub proxy_jump: Option<String>,
}

impl Target {
    pub fn resolve(connection: &SavedConnection) -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        let config = ssh_config::resolve(connection.host.trim());
        Self::with_config(connection, &config, &home)
    }

    pub fn with_config(connection: &SavedConnection, config: &ssh_config::HostConfig, home: &Path) -> Self {
        let host = config.hostname.clone().unwrap_or_else(|| connection.host.trim().to_string());
        // A port typed into the form wins; the default 22 gives way to the config's.
        let port = if connection.port != 22 { connection.port } else { config.port.unwrap_or(22) };
        let user = Some(connection.username.trim().to_string())
            .filter(|user| !user.is_empty())
            .or_else(|| config.user.clone())
            .or_else(|| std::env::var("USER").ok())
            .or_else(|| std::env::var("USERNAME").ok())
            .unwrap_or_default();
        let mut keys = Vec::new();
        match connection.key_path.as_deref().map(str::trim).filter(|key| !key.is_empty()) {
            Some(key) => keys.push(ssh_config::expand_home(key, home)),
            None => {
                for key in &config.identity_files {
                    if !keys.contains(key) {
                        keys.push(key.clone());
                    }
                }
            }
        }
        Self { host, port, user, keys, proxy_jump: config.proxy_jump.clone() }
    }
}

/// The `ssh -W` process carrying a `ProxyJump` connection; it ends with the session.
pub struct ProxyProcess(Child);

impl Drop for ProxyProcess {
    fn drop(&mut self) {
        self.0.kill().ok();
        self.0.wait().ok();
    }
}

pub struct Connected {
    pub session: Session,
    pub proxy: Option<ProxyProcess>,
}

fn home() -> Result<PathBuf> {
    dirs::home_dir().context("Cannot locate SSH trusted hosts: the home directory is unavailable.")
}

/// Connects, checks the server's key and authenticates.
pub fn connect(target: &Target, password: Option<&str>) -> Result<Connected> {
    let home = home()?;
    let connected = handshake(target)?;
    known_hosts::verify_session(&connected.session, &target.host, target.port, &home)?;
    authenticate(&connected.session, target, password, &home)?;
    connected.session.set_timeout(SESSION_TIMEOUT_MS);
    connected.session.set_keepalive(false, KEEPALIVE_SECONDS);
    Ok(connected)
}

/// Trusts the server after the user approved `fingerprint` in the trust dialog.
pub fn trust(target: &Target, fingerprint: &str) -> Result<()> {
    let connected = handshake(target)?;
    known_hosts::trust_session(&connected.session, &target.host, target.port, &home()?, fingerprint)
}

fn handshake(target: &Target) -> Result<Connected> {
    known_hosts::validate_endpoint(&target.host, target.port)?;
    let mut session = Session::new()?;
    session.set_timeout(CONNECT_TIMEOUT.as_millis() as u32);
    let proxy = match target.proxy_jump.as_deref() {
        Some(jumps) => Some(proxy_transport(&mut session, jumps, &target.host, target.port)?),
        None => {
            session.set_tcp_stream(tcp(&target.host, target.port)?);
            None
        }
    };
    session.handshake().map_err(|error| {
        anyhow!(
            "SSH handshake with {}:{} failed before authentication: {error}. Check the server's SSH logs and \
             the network connection.",
            target.host,
            target.port
        )
    })?;
    Ok(Connected { session, proxy })
}

fn tcp(host: &str, port: u16) -> Result<TcpStream> {
    let addresses = (host, port).to_socket_addrs().with_context(|| format!("Failed to resolve {host}:{port}"))?;
    let mut last_error = "no addresses found".to_string();
    for address in addresses {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = error.to_string(),
        }
    }
    bail!("Failed to connect to {host}:{port}: {last_error}")
}

/// The `ssh` command that carries a connection through `ProxyJump` hosts (`a,b,c`): the last hop
/// is the destination of `ssh -W`, the others go to `-J`.
pub fn proxy_command(jumps: &str, host: &str, port: u16) -> Result<Vec<String>> {
    let mut hops: Vec<&str> = jumps.split(',').map(str::trim).filter(|hop| !hop.is_empty()).collect();
    let last = hops.pop().ok_or_else(|| anyhow!("ProxyJump is empty"))?;
    if [host, last].iter().chain(hops.iter()).any(|value| value.starts_with('-') || value.chars().any(char::is_whitespace)) {
        bail!("Invalid ProxyJump {jumps:?}");
    }
    let destination = if last.contains("://") || !last.contains(':') { last.to_string() } else { format!("ssh://{last}") };
    let forward = if host.contains(':') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
    let mut command = vec!["ssh".to_string(), "-o".into(), "BatchMode=yes".into(), "-W".into(), forward];
    if !hops.is_empty() {
        command.push("-J".into());
        command.push(hops.join(","));
    }
    command.push(destination);
    Ok(command)
}

#[cfg(unix)]
fn proxy_transport(session: &mut Session, jumps: &str, host: &str, port: u16) -> Result<ProxyProcess> {
    use std::{
        os::{fd::OwnedFd, unix::net::UnixStream},
        process::{Command, Stdio},
    };
    let command = proxy_command(jumps, host, port)?;
    let (ours, theirs) = UnixStream::pair()?;
    let child = Command::new(&command[0])
        .args(&command[1..])
        .stdin(Stdio::from(OwnedFd::from(theirs.try_clone()?)))
        .stdout(Stdio::from(OwnedFd::from(theirs)))
        .stderr(Stdio::null())
        .spawn()
        .context("Failed to start ssh for ProxyJump")?;
    session.set_tcp_stream(ours);
    Ok(ProxyProcess(child))
}

/// Windows has no socket pair to hand `ssh` as its stdio, so its pipes are bridged to a loopback
/// TCP connection that libssh2 reads like any other.
#[cfg(not(unix))]
fn proxy_transport(session: &mut Session, jumps: &str, host: &str, port: u16) -> Result<ProxyProcess> {
    use std::process::{Command, Stdio};
    let command = proxy_command(jumps, host, port)?;
    let mut process = Command::new(&command[0]);
    process.args(&command[1..]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        process.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = process.spawn().context("Failed to start ssh for ProxyJump")?;
    session.set_tcp_stream(loopback_bridge(&mut child)?);
    Ok(ProxyProcess(child))
}

/// A loopback TCP stream whose other end is `child`'s stdin and stdout, copied by two threads that
/// end when either side closes.
#[cfg_attr(unix, allow(dead_code))]
pub(crate) fn loopback_bridge(child: &mut Child) -> Result<TcpStream> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let ours = TcpStream::connect(listener.local_addr()?)?;
    let (theirs, _) = listener.accept()?;
    let (mut stdin, mut stdout) = (child.stdin.take().context("ssh has no stdin")?, child.stdout.take().context("ssh has no stdout")?);
    let mut to_child = theirs.try_clone()?;
    let mut from_child = theirs;
    std::thread::spawn(move || {
        std::io::copy(&mut to_child, &mut stdin).ok();
    });
    std::thread::spawn(move || {
        std::io::copy(&mut stdout, &mut from_child).ok();
        from_child.shutdown(std::net::Shutdown::Both).ok();
    });
    Ok(ours)
}

/// Athas's defaults, in its order, when they exist.
fn default_keys(home: &Path) -> Vec<PathBuf> {
    ["id_ed25519", "id_rsa", "id_ecdsa"].into_iter().map(|name| home.join(".ssh").join(name)).filter(|path| path.is_file()).collect()
}

/// The keys to offer: the target's, then the defaults not already listed.
fn keys_to_try(target: &Target, home: &Path) -> Vec<PathBuf> {
    let mut keys = target.keys.clone();
    for key in default_keys(home) {
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys
}

/// Every method in turn, as `create_ssh_session_with_config`: the key files, the SSH agent, then
/// the password. Without a password, a server that takes one asks for it ([`PasswordRequired`],
/// the project picker's `isRemoteAuthFailure` → password prompt).
fn authenticate(session: &Session, target: &Target, password: Option<&str>, home: &Path) -> Result<()> {
    let user = target.user.as_str();
    // Asking for the methods tries "none", which some servers accept.
    let methods = session.auth_methods(user).unwrap_or_default().to_string();
    if session.authenticated() {
        return Ok(());
    }
    let takes_password = methods.is_empty() || methods.contains("password") || methods.contains("keyboard-interactive");

    let mut failures = Vec::new();
    for key in keys_to_try(target, home) {
        if !key.is_file() {
            failures.push(format!("Key {} not found", key.display()));
            continue;
        }
        match session.userauth_pubkey_file(user, None, &key, None) {
            Ok(()) if session.authenticated() => return Ok(()),
            Ok(()) => {}
            Err(error) => failures.push(format!("Key {} failed: {error}", key.display())),
        }
    }
    if agent_auth(session, user, &mut failures) {
        return Ok(());
    }
    if let Some(password) = password {
        return password_auth(session, target, password);
    }
    if takes_password {
        return Err(PasswordRequired { user: user.to_string(), host: target.host.clone(), rejected: false }.into());
    }
    bail!(
        "No valid authentication method available for {user}@{}. {}. For an encrypted private key, unlock it with \
         ssh-add and retry using the SSH agent.",
        target.host,
        failures.join("; ")
    )
}

fn agent_auth(session: &Session, user: &str, failures: &mut Vec<String>) -> bool {
    match session.userauth_agent(user) {
        Ok(()) => session.authenticated(),
        Err(error) => {
            failures.push(format!("SSH agent authentication failed: {error}"));
            false
        }
    }
}

fn password_auth(session: &Session, target: &Target, password: &str) -> Result<()> {
    if matches!(session.userauth_password(&target.user, password), Ok(())) && session.authenticated() {
        return Ok(());
    }
    // Servers that only offer keyboard-interactive (PAM, many default sshd setups) refuse the
    // password method; they ask for the same password as a prompt.
    let mut prompter = PasswordPrompter(password.to_string());
    if matches!(session.userauth_keyboard_interactive(&target.user, &mut prompter), Ok(())) && session.authenticated() {
        return Ok(());
    }
    Err(PasswordRequired { user: target.user.clone(), host: target.host.clone(), rejected: true }.into())
}

/// Answers each keyboard-interactive prompt with the password.
struct PasswordPrompter(String);

impl ssh2::KeyboardInteractivePrompt for PasswordPrompter {
    fn prompt<'a>(&mut self, _username: &str, _instructions: &str, prompts: &[ssh2::Prompt<'a>]) -> Vec<String> {
        prompts.iter().map(|_| self.0.clone()).collect()
    }
}

/// What a command printed and how it ended.
#[derive(Clone, Debug, Default)]
pub struct ExecOutput {
    pub status: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl ExecOutput {
    /// Stdout as text when the command succeeded; stderr (or stdout) as the error otherwise.
    pub fn into_result(self) -> Result<String> {
        if self.status == 0 {
            return Ok(String::from_utf8_lossy(&self.stdout).into_owned());
        }
        let stderr = String::from_utf8_lossy(&self.stderr);
        let stdout = String::from_utf8_lossy(&self.stdout);
        let details = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        if details.is_empty() {
            bail!("Remote command failed with exit status {}", self.status);
        }
        bail!("{details}")
    }
}

/// Runs `command` through the remote user's shell, feeding it `stdin`.
pub fn exec(session: &Session, command: &str, stdin: Option<&[u8]>) -> Result<ExecOutput> {
    let mut channel = session.channel_session().context("Failed to open a channel")?;
    channel.exec(command).context("Failed to run the remote command")?;
    // Stdin, stdout and stderr are pumped together without blocking: reading one stream to the
    // end first stalls the command once the other fills its SSH window, and both sides wait.
    // The caller holds the connection's lock, so nothing else uses the session meanwhile.
    session.set_blocking(false);
    let pumped = pump(&mut channel, stdin.unwrap_or_default());
    session.set_blocking(true);
    let (stdout, stderr) = pumped?;
    channel.wait_close().ok();
    let status = channel.exit_status().context("Failed to read the remote exit status")?;
    Ok(ExecOutput { status, stdout, stderr })
}

fn pump(channel: &mut ssh2::Channel, input: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
    let idle_limit = Duration::from_millis(SESSION_TIMEOUT_MS as u64);
    let mut written = 0;
    let mut eof_sent = false;
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut buffer = vec![0; 32 * 1024];
    let mut last_progress = std::time::Instant::now();
    loop {
        let mut progressed = false;
        if written < input.len() {
            match channel.write(&input[written..]) {
                Ok(count) => {
                    written += count;
                    progressed |= count > 0;
                }
                Err(error) if would_block(&error) => {}
                Err(error) => return Err(error).context("Failed to send the command's input"),
            }
        }
        if written == input.len() && !eof_sent {
            match channel.send_eof() {
                Ok(()) => eof_sent = true,
                Err(error) if error.code() == ssh2::ErrorCode::Session(-37) => {}
                Err(_) => eof_sent = true,
            }
        }
        let out_done = read_some(channel, 0, &mut buffer, &mut stdout, &mut progressed).context("Failed to read the command's output")?;
        let err_done = read_some(channel, 1, &mut buffer, &mut stderr, &mut progressed).context("Failed to read the command's errors")?;
        if out_done && err_done && channel.eof() {
            return Ok((stdout, stderr));
        }
        if progressed {
            last_progress = std::time::Instant::now();
        } else if last_progress.elapsed() > idle_limit {
            bail!("The remote command stopped responding");
        } else {
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}

/// Reads what is ready on one stream; true once that stream has ended.
fn read_some(channel: &mut ssh2::Channel, stream: i32, buffer: &mut [u8], into: &mut Vec<u8>, progressed: &mut bool) -> std::io::Result<bool> {
    loop {
        match channel.stream(stream).read(buffer) {
            Ok(0) => return Ok(channel.eof()),
            Ok(count) => {
                into.extend_from_slice(&buffer[..count]);
                *progressed = true;
            }
            Err(error) if would_block(&error) => return Ok(false),
            Err(error) => return Err(error),
        }
    }
}

fn would_block(error: &std::io::Error) -> bool {
    matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted)
}

/// A message for a failed connection that says what to do (`services/remote-errors.ts`).
pub fn friendly_error(error: &anyhow::Error) -> String {
    if error.downcast_ref::<known_hosts::HostKeyChallenge>().is_some() {
        return error.to_string();
    }
    let raw = format!("{error:#}");
    let message = raw.to_lowercase();
    if message.contains("host key verification") || message.contains("ssh trusted hosts") || message.contains("server trust") {
        raw
    } else if message.contains("password was refused") {
        "Incorrect username or password. Please try again.".into()
    } else if message.contains("permission denied") || message.contains("no valid authentication") {
        format!("Permission denied. Check your credentials or SSH key configuration. ({raw})")
    } else if message.contains("connection refused") || message.contains("actively refused") {
        "Connection refused. Check the host address and port.".into()
    } else if message.contains("no route to host") || message.contains("unreachable") {
        "Cannot reach the server. Check your network connection.".into()
    } else if message.contains("timed out") || message.contains("timeout") {
        "Connection timed out. The server may be unavailable.".into()
    } else if message.contains("failed to resolve") {
        "Cannot find that host. Check the address.".into()
    } else {
        raw
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection(host: &str, port: u16, user: &str) -> SavedConnection {
        let mut connection = SavedConnection::for_config_host(host);
        connection.port = port;
        connection.username = user.into();
        connection
    }

    #[test]
    fn config_fills_in_what_the_form_left_out() {
        let config = ssh_config::parse(
            "Host dev\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/dev\n  ProxyJump bastion\n",
            "dev",
            Path::new("/home/me"),
        );
        let target = Target::with_config(&connection("dev", 22, ""), &config, Path::new("/home/me"));
        assert_eq!(target.host, "10.0.0.5");
        assert_eq!(target.port, 2222);
        assert_eq!(target.user, "deploy");
        assert_eq!(target.keys, vec![PathBuf::from("/home/me/.ssh/dev")]);
        assert_eq!(target.proxy_jump.as_deref(), Some("bastion"));

        let mut typed = connection("dev", 2200, "me");
        typed.key_path = Some("~/.ssh/typed".into());
        let target = Target::with_config(&typed, &config, Path::new("/home/me"));
        assert_eq!((target.port, target.user.as_str()), (2200, "me"));
        // The form's key stands in for the config's, as `key_path.or(identity_file)`.
        assert_eq!(target.keys, vec![PathBuf::from("/home/me/.ssh/typed")]);
    }

    #[test]
    fn offers_the_typed_or_configured_key_then_the_defaults() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".ssh")).unwrap();
        for name in ["id_ecdsa", "id_ed25519", "id_rsa", "dev"] {
            std::fs::write(home.path().join(".ssh").join(name), "").unwrap();
        }
        let config = ssh_config::parse("Host dev\n  IdentityFile ~/.ssh/dev\n", "dev", home.path());
        let ssh = home.path().join(".ssh");
        let target = Target::with_config(&connection("dev", 22, ""), &config, home.path());
        assert_eq!(keys_to_try(&target, home.path()), vec![ssh.join("dev"), ssh.join("id_ed25519"), ssh.join("id_rsa"), ssh.join("id_ecdsa")]);

        let mut typed = connection("dev", 22, "");
        typed.key_path = Some(ssh.join("id_rsa").to_string_lossy().into_owned());
        let target = Target::with_config(&typed, &config, home.path());
        assert_eq!(keys_to_try(&target, home.path()), vec![ssh.join("id_rsa"), ssh.join("id_ed25519"), ssh.join("id_ecdsa")]);
    }

    #[cfg(unix)]
    #[test]
    fn loopback_bridge_carries_bytes_both_ways() {
        use std::{
            io::{Read as _, Write as _},
            process::{Command, Stdio},
        };
        let mut child = Command::new("cat").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let mut stream = loopback_bridge(&mut child).unwrap();
        stream.write_all(b"SSH-2.0-test\r\n").unwrap();
        let mut echoed = [0u8; 14];
        stream.read_exact(&mut echoed).unwrap();
        assert_eq!(&echoed, b"SSH-2.0-test\r\n");
        child.kill().ok();
        child.wait().ok();
        let mut rest = Vec::new();
        stream.read_to_end(&mut rest).ok();
        assert!(rest.is_empty());
    }

    #[test]
    fn builds_proxy_commands() {
        assert_eq!(proxy_command("bastion", "10.0.0.5", 22).unwrap(), ["ssh", "-o", "BatchMode=yes", "-W", "10.0.0.5:22", "bastion"]);
        assert_eq!(
            proxy_command("ops@a:2200, b,me@c:2222", "::1", 2222).unwrap(),
            ["ssh", "-o", "BatchMode=yes", "-W", "[::1]:2222", "-J", "ops@a:2200,b", "ssh://me@c:2222"]
        );
        assert!(proxy_command("", "h", 22).is_err());
        assert!(proxy_command("-oProxyCommand=evil", "h", 22).is_err());
    }

    #[test]
    fn friendly_errors() {
        let error = anyhow::Error::new(PasswordRequired { user: "me".into(), host: "h".into(), rejected: true });
        assert_eq!(friendly_error(&error), "Incorrect username or password. Please try again.");
        assert_eq!(friendly_error(&anyhow!("Failed to connect to h:22: Connection refused (os error 61)")), "Connection refused. Check the host address and port.");
        let challenge = known_hosts::HostKeyChallenge { host: "h".into(), port: 22, fingerprint: "SHA256:x".into() };
        assert!(friendly_error(&challenge.into()).contains("SHA256:x"));
    }

    #[test]
    fn exec_output_reports_errors() {
        let ok = ExecOutput { status: 0, stdout: b"hi\n".to_vec(), stderr: Vec::new() };
        assert_eq!(ok.into_result().unwrap(), "hi\n");
        let failed = ExecOutput { status: 1, stdout: b"out".to_vec(), stderr: b" fatal: nope \n".to_vec() };
        assert_eq!(failed.into_result().unwrap_err().to_string(), "fatal: nope");
        assert!(ExecOutput { status: 2, ..Default::default() }.into_result().unwrap_err().to_string().contains("status 2"));
    }
}
