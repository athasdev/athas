//! The local channel between the `athas` command (or a second launch of the app) and the running
//! app: a Unix domain socket in the app's data folder, or a named pipe on Windows.
//!
//! Debug builds use their own channel so a development build never hands its requests to an
//! installed Athas, and the other way round.

use std::path::PathBuf;

#[cfg(not(target_family = "wasm"))]
const CHANNEL_NAME: &str = if cfg!(debug_assertions) { "athas-dev" } else { "athas" };

/// Where the running app listens. `ATHAS_SOCKET` overrides it.
pub fn socket_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("ATHAS_SOCKET") {
        return Some(PathBuf::from(path));
    }
    imp::default_path()
}

/// What binding the channel found.
pub enum Bound {
    /// This process now receives the requests.
    Listening(Listener),
    /// Another Athas answers on the channel already.
    AlreadyRunning,
}

pub use imp::{Listener, Stream, bind, connect};

#[cfg(unix)]
mod imp {
    use std::{
        io,
        os::unix::{
            fs::PermissionsExt,
            net::{UnixListener, UnixStream},
        },
        path::{Path, PathBuf},
        time::Duration,
    };

    use super::{Bound, CHANNEL_NAME};

    /// `sun_path` holds 104 bytes on macOS and 108 on Linux, with the terminating zero.
    const MAX_SOCKET_PATH: usize = 100;
    const TIMEOUT: Duration = Duration::from_secs(5);

    pub type Stream = UnixStream;

    pub(super) fn default_path() -> Option<PathBuf> {
        let path = crate::data_dir()?.join(format!("{CHANNEL_NAME}.sock"));
        if path.as_os_str().len() < MAX_SOCKET_PATH {
            return Some(path);
        }
        // A home folder with a long name: fall back to the per-user temporary folder.
        Some(std::env::temp_dir().join(format!("{}-{CHANNEL_NAME}.sock", crate::APP_ID)))
    }

    pub struct Listener(UnixListener);

    impl Listener {
        pub fn accept(&self) -> io::Result<Stream> {
            let (stream, _) = self.0.accept()?;
            stream.set_read_timeout(Some(TIMEOUT))?;
            stream.set_write_timeout(Some(TIMEOUT))?;
            Ok(stream)
        }
    }

    pub fn connect(path: &Path) -> io::Result<Stream> {
        let stream = UnixStream::connect(path)?;
        stream.set_read_timeout(Some(TIMEOUT))?;
        stream.set_write_timeout(Some(TIMEOUT))?;
        Ok(stream)
    }

    /// Listens on `path`, unless an app answers there already. A socket file nobody answers on
    /// is left over from an app that quit without cleaning up, and is replaced.
    pub fn bind(path: &Path) -> io::Result<Bound> {
        if UnixStream::connect(path).is_ok() {
            return Ok(Bound::AlreadyRunning);
        }
        match std::fs::remove_file(path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let listener = UnixListener::bind(path)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        Ok(Bound::Listening(Listener(listener)))
    }
}

/// The browser has no local channel to other processes.
#[cfg(target_family = "wasm")]
mod imp {
    use std::{
        io,
        net::TcpStream,
        path::{Path, PathBuf},
    };

    use super::Bound;

    pub type Stream = TcpStream;

    pub(super) fn default_path() -> Option<PathBuf> {
        None
    }

    fn unsupported() -> io::Error {
        io::Error::new(io::ErrorKind::Unsupported, "the browser has no local app channel")
    }

    pub struct Listener;

    impl Listener {
        pub fn accept(&self) -> io::Result<Stream> {
            Err(unsupported())
        }
    }

    pub fn connect(_: &Path) -> io::Result<Stream> {
        Err(unsupported())
    }

    pub fn bind(_: &Path) -> io::Result<Bound> {
        Err(unsupported())
    }
}

#[cfg(windows)]
mod imp {
    use std::{
        fs::{File, OpenOptions},
        io,
        os::windows::{ffi::OsStrExt, io::FromRawHandle},
        path::{Path, PathBuf},
        sync::Mutex,
    };

    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_PIPE_CONNECTED, GetLastError, HANDLE, INVALID_HANDLE_VALUE, LocalFree},
        Security::{
            Authorization::{ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1},
            EqualSid, GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER, TokenUser,
        },
        Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX},
        System::{
            Pipes::{
                ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeServerProcessId, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
            },
            Threading::{GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION},
        },
    };

    use super::{Bound, CHANNEL_NAME};

    pub type Stream = File;

    pub(super) fn default_path() -> Option<PathBuf> {
        let user = std::env::var("USERNAME").unwrap_or_default();
        Some(PathBuf::from(format!(r"\\.\pipe\{CHANNEL_NAME}-{user}")))
    }

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    /// The user (SID bytes) a process runs as; `None` for this process.
    fn process_user(pid: Option<u32>) -> io::Result<Vec<u8>> {
        unsafe {
            let process: HANDLE = match pid {
                None => GetCurrentProcess(),
                Some(pid) => {
                    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if process.is_null() {
                        return Err(io::Error::last_os_error());
                    }
                    process
                }
            };
            let mut token: HANDLE = std::ptr::null_mut();
            let opened = OpenProcessToken(process, TOKEN_QUERY, &mut token);
            if pid.is_some() {
                CloseHandle(process);
            }
            if opened == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut needed = 0u32;
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut needed);
            // u64 words keep the TOKEN_USER header aligned.
            let mut buffer = vec![0u64; (needed as usize).div_ceil(8).max(1)];
            let ok = GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), (buffer.len() * 8) as u32, &mut needed);
            CloseHandle(token);
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            let user = &*(buffer.as_ptr() as *const TOKEN_USER);
            let sid = user.User.Sid;
            let length = windows_sys::Win32::Security::GetLengthSid(sid) as usize;
            Ok(std::slice::from_raw_parts(sid as *const u8, length).to_vec())
        }
    }

    /// An owner-only security descriptor: the pipe's default one lets every local user connect.
    fn owner_only_descriptor() -> io::Result<PSECURITY_DESCRIPTOR> {
        let mut sid = process_user(None)?;
        unsafe {
            let mut text: *mut u16 = std::ptr::null_mut();
            if ConvertSidToStringSidW(sid.as_mut_ptr().cast(), &mut text) == 0 {
                return Err(io::Error::last_os_error());
            }
            let length = (0..).take_while(|&index| *text.add(index) != 0).count();
            let sid_text = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
            LocalFree(text.cast());
            let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid_text})(A;;GA;;;SY)").encode_utf16().chain(Some(0)).collect();
            let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.as_ptr(), SDDL_REVISION_1, &mut descriptor, std::ptr::null_mut()) == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(descriptor)
        }
    }

    fn create_instance(name: &[u16], first: bool) -> io::Result<File> {
        let mut open_mode = PIPE_ACCESS_DUPLEX;
        if first {
            open_mode |= FILE_FLAG_FIRST_PIPE_INSTANCE;
        }
        let descriptor = owner_only_descriptor()?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                open_mode,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                64 * 1024,
                64 * 1024,
                0,
                &attributes,
            )
        };
        unsafe { LocalFree(descriptor) };
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        Ok(unsafe { File::from_raw_handle(handle as _) })
    }

    pub struct Listener {
        name: Vec<u16>,
        next: Mutex<Option<File>>,
    }

    impl Listener {
        pub fn accept(&self) -> io::Result<Stream> {
            let pending = self.next.lock().map_err(|_| io::Error::other("pipe lock poisoned"))?.take();
            let pipe = match pending {
                Some(pipe) => pipe,
                None => create_instance(&self.name, false)?,
            };
            use std::os::windows::io::AsRawHandle;
            let connected = unsafe { ConnectNamedPipe(pipe.as_raw_handle() as _, std::ptr::null_mut()) };
            if connected == 0 && unsafe { GetLastError() } != ERROR_PIPE_CONNECTED {
                return Err(io::Error::last_os_error());
            }
            Ok(pipe)
        }
    }

    /// Opens the pipe, refusing one served by another user's process: the name is predictable,
    /// so another account could create it first and read the paths and commands sent to it.
    pub fn connect(path: &Path) -> io::Result<Stream> {
        use std::os::windows::io::AsRawHandle;
        let pipe = OpenOptions::new().read(true).write(true).open(path)?;
        let mut server = 0u32;
        if unsafe { GetNamedPipeServerProcessId(pipe.as_raw_handle() as _, &mut server) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut theirs = process_user(Some(server))?;
        let mut ours = process_user(None)?;
        if unsafe { EqualSid(theirs.as_mut_ptr().cast(), ours.as_mut_ptr().cast()) } == 0 {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "the Athas pipe belongs to another user"));
        }
        Ok(pipe)
    }

    pub fn bind(path: &Path) -> io::Result<Bound> {
        if connect(path).is_ok() {
            return Ok(Bound::AlreadyRunning);
        }
        let name = wide(path);
        match create_instance(&name, true) {
            Ok(first) => Ok(Bound::Listening(Listener { name, next: Mutex::new(Some(first)) })),
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => Ok(Bound::AlreadyRunning),
            Err(error) => Err(error),
        }
    }
}
