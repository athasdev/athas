//! Whether the computer has a network connection (`use-online-status.ts`, `navigator.onLine`):
//! an interface other than loopback is up with a routable address. True when it cannot tell.

/// Prompts held while offline are tried again this often.
pub const RECHECK: std::time::Duration = std::time::Duration::from_secs(2);

#[cfg(all(unix, not(target_family = "wasm")))]
pub fn is_online() -> bool {
    let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs fills `list` with a linked list freed below with freeifaddrs.
    if unsafe { libc::getifaddrs(&mut list) } != 0 {
        return true;
    }
    let mut online = false;
    let mut entry = list;
    while !entry.is_null() {
        // SAFETY: `entry` is a node of the list getifaddrs returned, alive until freeifaddrs.
        let interface = unsafe { &*entry };
        entry = interface.ifa_next;
        let flags = interface.ifa_flags as libc::c_int;
        let up = flags & libc::IFF_UP != 0 && flags & libc::IFF_RUNNING != 0 && flags & libc::IFF_LOOPBACK == 0;
        if !up || interface.ifa_addr.is_null() {
            continue;
        }
        // SAFETY: a non-null ifa_addr points at a sockaddr whose family says how to read it.
        let address = unsafe { &*interface.ifa_addr };
        online = match address.sa_family as libc::c_int {
            libc::AF_INET => {
                // SAFETY: an AF_INET address is a sockaddr_in.
                let ip = std::net::Ipv4Addr::from(u32::from_be(unsafe { (*(interface.ifa_addr as *const libc::sockaddr_in)).sin_addr.s_addr }));
                routable_v4(ip)
            }
            libc::AF_INET6 => {
                // SAFETY: an AF_INET6 address is a sockaddr_in6.
                let ip = std::net::Ipv6Addr::from(unsafe { (*(interface.ifa_addr as *const libc::sockaddr_in6)).sin6_addr.s6_addr });
                routable_v6(ip)
            }
            _ => false,
        };
        if online {
            break;
        }
    }
    // SAFETY: `list` came from getifaddrs and is freed once.
    unsafe { libc::freeifaddrs(list) };
    online
}

#[cfg(not(all(unix, not(target_family = "wasm"))))]
pub fn is_online() -> bool {
    true
}

/// Not loopback, unspecified or link-local (169.254/16, which an interface gets without a network).
pub fn routable_v4(ip: std::net::Ipv4Addr) -> bool {
    !ip.is_loopback() && !ip.is_unspecified() && !ip.is_link_local()
}

/// Not loopback, unspecified or link-local (fe80::/10, which every interface has).
pub fn routable_v6(ip: std::net::Ipv6Addr) -> bool {
    !ip.is_loopback() && !ip.is_unspecified() && (ip.segments()[0] & 0xffc0) != 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_local_addresses_are_no_connection() {
        assert!(!routable_v4("169.254.3.4".parse().unwrap()));
        assert!(!routable_v4("127.0.0.1".parse().unwrap()));
        assert!(routable_v4("192.168.1.20".parse().unwrap()));
        assert!(!routable_v6("fe80::1".parse().unwrap()));
        assert!(!routable_v6("::1".parse().unwrap()));
        assert!(routable_v6("2001:db8::1".parse().unwrap()));
    }
}
