//! What the view shows, worked out from the CLI's strings: states and their tones, ports, ages,
//! sorting and filtering, and the copy for an unreachable Docker.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

#[cfg(target_family = "wasm")]
use crate::athas_docker;
use athas_docker::{DockerComposeService, DockerContainer, DockerImage, DockerNetwork, DockerVolume};

/// How a state reads: the colour of its dot and label.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Success,
    Warning,
    Danger,
    Accent,
    Neutral,
}

/// A container's lifecycle state, as `docker ps` reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContainerState {
    Running,
    Paused,
    Restarting,
    Created,
    Exited,
    Dead,
    Removing,
    Unknown,
}

impl ContainerState {
    pub fn parse(state: &str) -> Self {
        match state.trim().to_ascii_lowercase().as_str() {
            "running" => Self::Running,
            "paused" => Self::Paused,
            "restarting" => Self::Restarting,
            "created" => Self::Created,
            "exited" => Self::Exited,
            "dead" => Self::Dead,
            "removing" => Self::Removing,
            _ => Self::Unknown,
        }
    }

    /// Running or about to be: what sorts first.
    pub fn is_live(self) -> bool {
        matches!(self, Self::Running | Self::Restarting | Self::Paused)
    }
}

/// The tone of a container or Compose service: health wins over state (`getDockerStateTone`).
pub fn state_tone(state: &str, health: Option<&str>) -> Tone {
    match health {
        Some("unhealthy") => return Tone::Danger,
        Some("healthy") => return Tone::Success,
        _ => {}
    }
    match ContainerState::parse(state) {
        ContainerState::Running => Tone::Success,
        ContainerState::Exited | ContainerState::Restarting => Tone::Warning,
        ContainerState::Dead => Tone::Danger,
        ContainerState::Paused => Tone::Accent,
        _ => Tone::Neutral,
    }
}

/// The badge text: the health when Docker reports one, else the state.
pub fn state_label(state: &str, health: Option<&str>) -> String {
    health.filter(|health| !health.is_empty()).unwrap_or(state).to_string()
}

/// `0.0.0.0:8080->80/tcp, :::8080->80/tcp, 443/tcp` as `8080→80/tcp, 443/tcp`: the host
/// address goes, and the IPv6 twin of an IPv4 mapping is dropped.
pub fn format_ports(ports: &str) -> String {
    let mut seen: Vec<String> = Vec::new();
    for entry in ports.split(',').map(str::trim).filter(|entry| !entry.is_empty()) {
        let formatted = match entry.split_once("->") {
            Some((host, target)) => {
                let host_port = host.rsplit_once(':').map_or(host, |(_, port)| port);
                format!("{host_port}→{target}")
            }
            None => entry.to_string(),
        };
        if !seen.contains(&formatted) {
            seen.push(formatted);
        }
    }
    seen.join(", ")
}

/// `http://localhost:<port>` for the first published TCP port (`getPublishedDockerTcpUrl`).
pub fn service_url(ports: &str) -> Option<String> {
    ports.split(',').map(str::trim).find_map(|entry| {
        let (host, target) = entry.split_once("->")?;
        if !target.ends_with("/tcp") {
            return None;
        }
        let port = host.rsplit_once(':').map_or(host, |(_, port)| port);
        (!port.is_empty() && port.bytes().all(|byte| byte.is_ascii_digit())).then(|| format!("http://localhost:{port}"))
    })
}

/// `repository:tag`, or the id for a dangling image (`getDockerImageReference`).
pub fn image_reference(image: &DockerImage) -> String {
    if image.repository == "<none>" || image.tag == "<none>" {
        short_id(&image.id).to_string()
    } else {
        format!("{}:{}", image.repository, image.tag)
    }
}

/// The first 12 characters of an id, without a `sha256:` prefix.
pub fn short_id(id: &str) -> &str {
    let id = id.strip_prefix("sha256:").unwrap_or(id);
    &id[..id.len().min(12)]
}

/// Seconds since the epoch for `docker ps`'s `CreatedAt`: `2026-06-27 10:00:00 +0000 UTC`.
pub fn parse_created_at(value: &str) -> Option<i64> {
    let mut parts = value.split_whitespace();
    let date = parts.next()?;
    let time = parts.next()?;
    let offset = parts.next().unwrap_or("+0000");

    let mut date_parts = date.split('-').map(str::parse::<i64>);
    let (year, month, day) = (date_parts.next()?.ok()?, date_parts.next()?.ok()?, date_parts.next()?.ok()?);
    let mut time_parts = time.split(':').map(|part| part.split('.').next().unwrap_or(part).parse::<i64>());
    let (hour, minute, second) = (time_parts.next()?.ok()?, time_parts.next()?.ok()?, time_parts.next()?.ok()?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    let offset_seconds = match offset.as_bytes() {
        [sign @ (b'+' | b'-'), digits @ ..] if digits.len() == 4 => {
            let digits = std::str::from_utf8(digits).ok()?;
            let hours: i64 = digits[..2].parse().ok()?;
            let minutes: i64 = digits[2..].parse().ok()?;
            let seconds = hours * 3600 + minutes * 60;
            if *sign == b'-' { -seconds } else { seconds }
        }
        _ => 0,
    };

    Some(days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second - offset_seconds)
}

/// Days from 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_index = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// `5 minutes ago`, the way `docker ps` words ages.
pub fn relative_age(then: i64, now: i64) -> String {
    let seconds = (now - then).max(0);
    let (count, unit) = match seconds {
        0..60 => return "Just now".to_string(),
        60..3600 => (seconds / 60, "minute"),
        3600..86_400 => (seconds / 3600, "hour"),
        86_400..604_800 => (seconds / 86_400, "day"),
        604_800..2_592_000 => (seconds / 604_800, "week"),
        2_592_000..31_536_000 => (seconds / 2_592_000, "month"),
        _ => (seconds / 31_536_000, "year"),
    };
    format!("{count} {unit}{} ago", if count == 1 { "" } else { "s" })
}

/// A container's age, or its raw `CreatedAt` when it cannot be read.
pub fn container_age(created_at: &str, now: i64) -> String {
    parse_created_at(created_at).map_or_else(|| created_at.to_string(), |then| relative_age(then, now))
}

/// Live containers first, then by name.
pub fn sort_containers(containers: &mut [DockerContainer]) {
    containers.sort_by(|a, b| {
        let live = |container: &DockerContainer| !ContainerState::parse(&container.state).is_live();
        live(a).cmp(&live(b)).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

/// By reference, with dangling (`<none>`) images last.
pub fn sort_images(images: &mut [DockerImage]) {
    images.sort_by(|a, b| {
        let dangling = |image: &DockerImage| image.repository == "<none>" || image.tag == "<none>";
        dangling(a)
            .cmp(&dangling(b))
            .then_with(|| image_reference(a).to_lowercase().cmp(&image_reference(b).to_lowercase()))
    });
}

pub fn sort_volumes(volumes: &mut [DockerVolume]) {
    volumes.sort_by_key(|volume| volume.name.to_lowercase());
}

pub fn sort_networks(networks: &mut [DockerNetwork]) {
    networks.sort_by_key(|network| network.name.to_lowercase());
}

pub fn sort_services(services: &mut [DockerComposeService]) {
    services.sort_by_key(|service| service.name.to_lowercase());
}

/// Whether any of `values` contains `query`, ignoring case. An empty query matches everything.
pub fn matches_query<'a>(values: impl IntoIterator<Item = &'a str>, query: &str) -> bool {
    let query = query.trim().to_lowercase();
    query.is_empty() || values.into_iter().any(|value| value.to_lowercase().contains(&query))
}

/// Errors that mean Docker itself is unreachable rather than one command failing.
pub fn is_connection_error(message: &str) -> bool {
    let message = message.to_lowercase();
    [
        "cannot connect to the docker daemon",
        "docker cli was not found",
        "error during connect",
        "failed to connect",
        "is the docker daemon running",
        "permission denied while trying to connect to the docker api",
        "connection refused",
    ]
    .iter()
    .any(|fragment| message.contains(fragment))
}

/// Title and guidance for an unreachable Docker (`getDockerUnavailableCopy`).
/// `getDockerUnavailableCopy`: the toast a failed action shows when Docker can't be reached.
pub fn toast_unavailable_copy(error: &str) -> (&'static str, &'static str) {
    if error.to_lowercase().contains("docker cli was not found") {
        ("Docker CLI isn't available", "Install Docker or make sure the Docker CLI is available in Athas.")
    } else if is_connection_error(error) {
        ("Docker isn't running", "Athas can't connect to the active Docker context.")
    } else {
        ("Docker is unavailable", "Athas couldn't load Docker resources.")
    }
}

pub fn unavailable_copy(error: &str) -> (&'static str, &'static str) {
    if error.to_lowercase().contains("docker cli was not found") {
        ("Docker isn't installed", "Install Docker Desktop, or make sure the docker CLI is on your PATH.")
    } else if is_connection_error(error) {
        ("Docker isn't running", "Start Docker Desktop (or your Docker daemon), then retry.")
    } else {
        ("Docker is unavailable", "Athas couldn't load Docker resources.")
    }
}

/// The last non-empty line of a command's output: what a notice says after an action.
pub fn last_line(output: &str) -> Option<&str> {
    output.lines().map(str::trim).rfind(|line| !line.is_empty())
}

/// Splits `docker logs --timestamps` output into its RFC 3339 timestamp and the message.
pub fn split_log_timestamp(line: &str) -> (Option<&str>, &str) {
    match line.split_once(' ') {
        Some((stamp, rest)) if looks_like_timestamp(stamp) => (Some(stamp), rest),
        _ => (None, line),
    }
}

fn looks_like_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 20
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
}

/// `2026-06-27T10:00:00.123456789Z` as `10:00:00.123`.
pub fn short_timestamp(stamp: &str) -> &str {
    let time = stamp.split_once('T').map_or(stamp, |(_, time)| time);
    let end = time.find(['Z', '+']).unwrap_or(time.len());
    &time[..end.min(12)]
}

/// The `docker` the view runs: `ATHAS_DOCKER_PROGRAM`, else the first one found.
pub fn default_program() -> OsString {
    std::env::var_os("ATHAS_DOCKER_PROGRAM").unwrap_or_else(|| resolve_program(std::env::var_os("PATH"), |path| path.is_file()))
}

/// Where the `docker` binary is. An app opened from the Finder has a short `PATH`, so the
/// usual install locations are tried after it.
pub fn resolve_program(path_env: Option<OsString>, exists: impl Fn(&Path) -> bool) -> OsString {
    const FALLBACKS: [&str; 4] = [
        "/usr/local/bin/docker",
        "/opt/homebrew/bin/docker",
        "/Applications/Docker.app/Contents/Resources/bin/docker",
        "/usr/bin/docker",
    ];
    let binary = if cfg!(windows) { "docker.exe" } else { "docker" };
    let from_path = path_env
        .iter()
        .flat_map(std::env::split_paths)
        .map(|dir| dir.join(binary))
        .find(|candidate| exists(candidate));
    from_path
        .or_else(|| FALLBACKS.iter().map(PathBuf::from).find(|candidate| exists(candidate)))
        .map_or_else(|| OsString::from("docker"), PathBuf::into_os_string)
}

/// One shell word: `value` in single quotes, as the terminal commands quote ids and paths.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// The command that opens bash, or sh, inside a running container (`getDockerExecCommand`).
pub fn exec_command(program: &str, container_id: &str) -> String {
    let probe = "if command -v bash >/dev/null 2>&1; then exec bash; elif command -v sh >/dev/null 2>&1; then exec sh; else echo \"No interactive shell found in this container.\" >&2; exit 127; fi";
    format!("{} exec -it {} sh -lc {}", shell_quote(program), shell_quote(container_id), shell_quote(probe))
}

/// The command that runs a debug command inside a container, in `workdir` when given
/// (`getDockerDebugCommand`).
pub fn debug_command(program: &str, container_id: &str, command: &str, workdir: Option<&str>) -> String {
    let command = match workdir.map(str::trim).filter(|workdir| !workdir.is_empty()) {
        Some(workdir) => format!("cd {} && {command}", shell_quote(workdir)),
        None => command.to_string(),
    };
    format!("{} exec -it {} sh -lc {}", shell_quote(program), shell_quote(container_id), shell_quote(&command))
}

/// The folder above a path in a container; `/` stays `/`.
pub fn parent_container_path(path: &str) -> String {
    let normalized = path.trim().trim_end_matches('/');
    if normalized.is_empty() {
        return "/".to_string();
    }
    match normalized.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(index) => normalized[..index].to_string(),
    }
}

/// A file size the way the container file list shows it.
pub fn format_file_size(size: u64) -> String {
    if size < 1024 {
        format!("{size} B")
    } else if size < 1024 * 1024 {
        format!("{} KB", (size as f64 / 1024.0).round() as u64)
    } else {
        format!("{:.1} MB", size as f64 / (1024.0 * 1024.0))
    }
}

/// The entries of a list field: split on newlines and commas, trimmed, empty ones dropped
/// (`splitDockerConfigLines`).
pub fn split_config_lines(value: &str) -> Vec<String> {
    value.split(['\n', ',']).map(str::trim).filter(|entry| !entry.is_empty()).map(str::to_string).collect()
}

/// The parts of a row's description, joined with a middle dot.
pub fn join_parts<'a>(parts: impl IntoIterator<Item = Option<&'a str>>) -> String {
    parts.into_iter().flatten().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" · ")
}

/// What a piece of a pretty-printed JSON line is, for colouring `docker inspect`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JsonToken {
    Key,
    String,
    Number,
    Literal,
}

/// The coloured spans of one line of pretty-printed JSON (keys, strings, numbers, literals).
pub fn json_line_tokens(line: &str) -> Vec<(std::ops::Range<usize>, JsonToken)> {
    let bytes = line.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => {
                let start = index;
                index += 1;
                while index < bytes.len() && bytes[index] != b'"' {
                    index += if bytes[index] == b'\\' { 2 } else { 1 };
                }
                index = (index + 1).min(bytes.len());
                let is_key = line[index..].trim_start().starts_with(':');
                tokens.push((start..index, if is_key { JsonToken::Key } else { JsonToken::String }));
            }
            b'-' | b'0'..=b'9' => {
                let start = index;
                while index < bytes.len() && matches!(bytes[index], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                    index += 1;
                }
                tokens.push((start..index, JsonToken::Number));
            }
            b't' | b'f' | b'n' => {
                let literal = ["true", "false", "null"].into_iter().find(|word| line[index..].starts_with(word));
                match literal {
                    Some(word) => {
                        tokens.push((index..index + word.len(), JsonToken::Literal));
                        index += word.len();
                    }
                    None => index += 1,
                }
            }
            _ => index += 1,
        }
    }
    tokens
}

pub fn plural(count: usize, noun: &str) -> String {
    format!("{count} {noun}{}", if count == 1 { "" } else { "s" })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn container(name: &str, state: &str) -> DockerContainer {
        DockerContainer {
            id: format!("{name}-id"),
            name: name.to_string(),
            image: "nginx".to_string(),
            command: String::new(),
            status: String::new(),
            state: state.to_string(),
            ports: String::new(),
            networks: String::new(),
            created_at: String::new(),
            size: String::new(),
            health: None,
            health_details: None,
            stats: None,
        }
    }

    fn image(repository: &str, tag: &str) -> DockerImage {
        DockerImage {
            id: "sha256:0123456789abcdef".to_string(),
            repository: repository.to_string(),
            tag: tag.to_string(),
            digest: String::new(),
            size: String::new(),
            created_since: String::new(),
        }
    }

    #[test]
    fn parses_states() {
        assert_eq!(ContainerState::parse("running"), ContainerState::Running);
        assert_eq!(ContainerState::parse(" Exited "), ContainerState::Exited);
        assert_eq!(ContainerState::parse("weird"), ContainerState::Unknown);
        assert!(ContainerState::Paused.is_live());
        assert!(!ContainerState::Created.is_live());
    }

    #[test]
    fn tones_follow_health_then_state() {
        assert_eq!(state_tone("running", Some("unhealthy")), Tone::Danger);
        assert_eq!(state_tone("exited", Some("healthy")), Tone::Success);
        assert_eq!(state_tone("running", None), Tone::Success);
        assert_eq!(state_tone("exited", None), Tone::Warning);
        assert_eq!(state_tone("paused", None), Tone::Accent);
        assert_eq!(state_tone("created", Some("starting")), Tone::Neutral);
        assert_eq!(state_label("running", Some("healthy")), "healthy");
        assert_eq!(state_label("running", None), "running");
    }

    #[test]
    fn formats_ports() {
        assert_eq!(format_ports("0.0.0.0:8080->80/tcp, :::8080->80/tcp, 443/tcp"), "8080→80/tcp, 443/tcp");
        assert_eq!(format_ports("[::]:5432->5432/tcp"), "5432→5432/tcp");
        assert_eq!(format_ports(""), "");
        assert_eq!(service_url("443/tcp, 0.0.0.0:8080->80/tcp").as_deref(), Some("http://localhost:8080"));
        assert_eq!(service_url("0.0.0.0:53->53/udp"), None);
        assert_eq!(service_url(""), None);
    }

    #[test]
    fn references_images() {
        assert_eq!(image_reference(&image("nginx", "latest")), "nginx:latest");
        assert_eq!(image_reference(&image("<none>", "<none>")), "0123456789ab");
        assert_eq!(short_id("abc"), "abc");
    }

    #[test]
    fn parses_created_at() {
        assert_eq!(parse_created_at("1970-01-01 00:00:00 +0000 UTC"), Some(0));
        assert_eq!(parse_created_at("2026-06-27 10:00:00 +0000 UTC"), Some(1_782_554_400));
        assert_eq!(parse_created_at("2026-06-27 12:00:00 +0200 CEST"), Some(1_782_554_400));
        assert_eq!(parse_created_at("not a date"), None);
        assert_eq!(relative_age(0, 30), "Just now");
        assert_eq!(relative_age(0, 60), "1 minute ago");
        assert_eq!(relative_age(0, 7200), "2 hours ago");
        assert_eq!(relative_age(0, 86_400 * 3), "3 days ago");
        assert_eq!(container_age("garbage", 0), "garbage");
    }

    #[test]
    fn sorts_live_containers_first() {
        let mut containers =
            vec![container("zeta", "exited"), container("beta", "running"), container("alpha", "created")];
        sort_containers(&mut containers);
        let names: Vec<_> = containers.iter().map(|container| container.name.as_str()).collect();
        assert_eq!(names, ["beta", "alpha", "zeta"]);
    }

    #[test]
    fn sorts_dangling_images_last() {
        let mut images = vec![image("<none>", "<none>"), image("redis", "7"), image("Alpine", "3")];
        sort_images(&mut images);
        let refs: Vec<_> = images.iter().map(image_reference).collect();
        assert_eq!(refs, ["Alpine:3", "redis:7", "0123456789ab"]);
    }

    #[test]
    fn filters_case_insensitively() {
        assert!(matches_query(["Postgres"], "post"));
        assert!(matches_query(["anything"], "  "));
        assert!(!matches_query(["redis", "cache"], "nginx"));
    }

    #[test]
    fn sorts_networks_by_name() {
        let network = |name: &str| DockerNetwork { id: name.into(), name: name.into(), driver: "bridge".into(), scope: "local".into(), internal: "false".into(), ipv6: "false".into() };
        let mut networks = vec![network("project_default"), network("Bridge"), network("host")];
        sort_networks(&mut networks);
        assert_eq!(networks.iter().map(|network| network.name.as_str()).collect::<Vec<_>>(), ["Bridge", "host", "project_default"]);
    }

    #[test]
    fn recognises_unreachable_docker() {
        let daemon = "failed to connect to the docker API at unix:///var/run/docker.sock";
        assert!(is_connection_error(daemon));
        assert_eq!(unavailable_copy(daemon).0, "Docker isn't running");
        assert_eq!(unavailable_copy("Docker CLI was not found. Install Docker").0, "Docker isn't installed");
        assert_eq!(unavailable_copy("no such image").0, "Docker is unavailable");
        assert_eq!(toast_unavailable_copy(daemon).1, "Athas can't connect to the active Docker context.");
        assert_eq!(toast_unavailable_copy("Docker CLI was not found").0, "Docker CLI isn't available");
        assert!(!is_connection_error("No such container: web"));
    }

    #[test]
    fn splits_log_lines() {
        let (stamp, message) = split_log_timestamp("2026-06-27T10:00:00.123456789Z listening on :80");
        assert_eq!(stamp, Some("2026-06-27T10:00:00.123456789Z"));
        assert_eq!(message, "listening on :80");
        assert_eq!(short_timestamp(stamp.unwrap()), "10:00:00.123");
        assert_eq!(short_timestamp("2026-06-27T10:00:00Z"), "10:00:00");
        assert_eq!(split_log_timestamp("plain line"), (None, "plain line"));
        assert_eq!(last_line("one\ntwo\n\n"), Some("two"));
    }

    #[test]
    fn resolves_the_docker_binary() {
        let path = Some(OsString::from("/nope:/bin/tools"));
        let found = resolve_program(path.clone(), |candidate| candidate == Path::new("/bin/tools/docker"));
        assert_eq!(found, OsString::from("/bin/tools/docker"));
        let fallback = resolve_program(path.clone(), |candidate| candidate == Path::new("/opt/homebrew/bin/docker"));
        assert_eq!(fallback, OsString::from("/opt/homebrew/bin/docker"));
        assert_eq!(resolve_program(path, |_| false), OsString::from("docker"));
    }

    #[test]
    fn tokenizes_json_lines() {
        let line = r#"    "Running": true, "Pid": 42, "Name": "/web\"x", "Gone": null"#;
        let tokens: Vec<_> = json_line_tokens(line).into_iter().map(|(range, token)| (&line[range], token)).collect();
        assert_eq!(
            tokens,
            [
                ("\"Running\"", JsonToken::Key),
                ("true", JsonToken::Literal),
                ("\"Pid\"", JsonToken::Key),
                ("42", JsonToken::Number),
                ("\"Name\"", JsonToken::Key),
                (r#""/web\"x""#, JsonToken::String),
                ("\"Gone\"", JsonToken::Key),
                ("null", JsonToken::Literal),
            ]
        );
    }

    #[test]
    fn terminal_commands_quote_every_word() {
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        let exec = exec_command("docker", "c1");
        assert!(exec.starts_with("'docker' exec -it 'c1' sh -lc 'if command -v bash"));
        assert_eq!(debug_command("docker", "c1", "python -m pdb app.py", Some(" /srv ")), "'docker' exec -it 'c1' sh -lc 'cd '\\''/srv'\\'' && python -m pdb app.py'");
        assert_eq!(debug_command("docker", "c1", "node --inspect", Some("")), "'docker' exec -it 'c1' sh -lc 'node --inspect'");
    }

    #[test]
    fn container_paths_and_sizes() {
        assert_eq!(parent_container_path("/"), "/");
        assert_eq!(parent_container_path("/etc"), "/");
        assert_eq!(parent_container_path("/etc/nginx/"), "/etc");
        assert_eq!(format_file_size(12), "12 B");
        assert_eq!(format_file_size(2048), "2 KB");
        assert_eq!(format_file_size(3 * 1024 * 1024 + 1), "3.0 MB");
        assert_eq!(split_config_lines("A=1, B=2\n\nC=3"), vec!["A=1", "B=2", "C=3"]);
        assert_eq!(join_parts([Some("Dev container"), None, Some(""), Some("image")]), "Dev container · image");
    }
}
