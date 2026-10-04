use ssh2::Session;
use std::{
   io::{Read, Write},
   path::Path,
};

const POSIX_RENAME: &[u8] = b"posix-rename@openssh.com";
const MAX_PACKET_BYTES: usize = 64 * 1024;

pub(super) fn overwrite_file_atomically(
   session: &Session,
   source: &Path,
   target: &Path,
) -> Result<(), String> {
   let mut channel = session
      .channel_session()
      .map_err(|error| error.to_string())?;
   channel
      .subsystem("sftp")
      .map_err(|error| error.to_string())?;
   write_packet(&mut channel, &[1, 0, 0, 0, 3])?;
   if !supports_posix_rename(&read_packet(&mut channel)?)? {
      return Err(
         "The SFTP server does not support atomic replacement. The original file was kept.".into(),
      );
   }
   let mut request = vec![200];
   request.extend_from_slice(&1_u32.to_be_bytes());
   push_string(&mut request, POSIX_RENAME)?;
   push_string(
      &mut request,
      source
         .to_str()
         .ok_or("The source path is not UTF-8.")?
         .as_bytes(),
   )?;
   push_string(
      &mut request,
      target
         .to_str()
         .ok_or("The target path is not UTF-8.")?
         .as_bytes(),
   )?;
   write_packet(&mut channel, &request)?;
   read_status(&read_packet(&mut channel)?)?;
   // The server's successful status is authoritative even if channel cleanup fails.
   let _ = channel.send_eof();
   let _ = channel.close();
   let _ = channel.wait_close();
   Ok(())
}

fn push_string(packet: &mut Vec<u8>, value: &[u8]) -> Result<(), String> {
   let size = u32::try_from(value.len()).map_err(|error| error.to_string())?;
   packet.extend_from_slice(&size.to_be_bytes());
   packet.extend_from_slice(value);
   Ok(())
}

fn write_packet(stream: &mut impl Write, packet: &[u8]) -> Result<(), String> {
   if packet.is_empty() || packet.len() > MAX_PACKET_BYTES {
      return Err("Invalid SFTP packet size.".into());
   }
   stream
      .write_all(&(packet.len() as u32).to_be_bytes())
      .map_err(|error| error.to_string())?;
   stream.write_all(packet).map_err(|error| error.to_string())
}

fn read_packet(stream: &mut impl Read) -> Result<Vec<u8>, String> {
   let mut header = [0; 4];
   stream
      .read_exact(&mut header)
      .map_err(|error| error.to_string())?;
   let size = u32::from_be_bytes(header) as usize;
   if size == 0 || size > MAX_PACKET_BYTES {
      return Err("Invalid SFTP packet size.".into());
   }
   let mut packet = vec![0; size];
   stream
      .read_exact(&mut packet)
      .map_err(|error| error.to_string())?;
   Ok(packet)
}

fn take_u32(packet: &mut &[u8]) -> Result<u32, String> {
   let value = packet.get(..4).ok_or("Truncated SFTP response.")?;
   let value = u32::from_be_bytes(
      value
         .try_into()
         .map_err(|error: std::array::TryFromSliceError| error.to_string())?,
   );
   *packet = &packet[4..];
   Ok(value)
}

fn take_string<'a>(packet: &mut &'a [u8]) -> Result<&'a [u8], String> {
   let size = take_u32(packet)? as usize;
   let value = packet.get(..size).ok_or("Truncated SFTP response.")?;
   *packet = &packet[size..];
   Ok(value)
}

fn supports_posix_rename(packet: &[u8]) -> Result<bool, String> {
   if packet.first() != Some(&2) {
      return Err("Invalid SFTP server greeting.".into());
   }
   let mut packet = &packet[1..];
   if take_u32(&mut packet)? != 3 {
      return Err("Unsupported SFTP protocol version.".into());
   }
   let mut supported = false;
   while !packet.is_empty() {
      let name = take_string(&mut packet)?;
      let version = take_string(&mut packet)?;
      supported |= name == POSIX_RENAME && version == b"1";
   }
   Ok(supported)
}

fn read_status(packet: &[u8]) -> Result<(), String> {
   if packet.first() != Some(&101) {
      return Err("Invalid SFTP rename response.".into());
   }
   let mut packet = &packet[1..];
   if take_u32(&mut packet)? != 1 {
      return Err("The SFTP response belongs to another request.".into());
   }
   let status = take_u32(&mut packet)?;
   let message = take_string(&mut packet)?;
   take_string(&mut packet)?;
   if !packet.is_empty() {
      return Err("Invalid SFTP rename response.".into());
   }
   if status != 0 {
      return Err(format!(
         "SFTP atomic replacement failed ({status}): {}",
         String::from_utf8_lossy(message)
      ));
   }
   Ok(())
}

#[cfg(test)]
mod tests {
   use super::*;
   use std::io::Cursor;

   #[test]
   fn requires_the_supported_atomic_rename_extension_version() {
      let mut packet = vec![2, 0, 0, 0, 3];
      push_string(&mut packet, POSIX_RENAME).unwrap();
      push_string(&mut packet, b"2").unwrap();
      assert!(!supports_posix_rename(&packet).unwrap());
      packet.pop();
      packet.push(b'1');
      assert!(supports_posix_rename(&packet).unwrap());
      packet.pop();
      assert!(supports_posix_rename(&packet).is_err());
      assert!(!supports_posix_rename(&[2, 0, 0, 0, 3]).unwrap());
   }

   #[test]
   fn rejects_truncated_oversized_and_wrong_type_frames() {
      assert!(read_packet(&mut Cursor::new([0, 0, 0, 0])).is_err());
      assert!(read_packet(&mut Cursor::new(u32::MAX.to_be_bytes())).is_err());
      assert!(read_packet(&mut Cursor::new([0, 0, 0, 5, 2])).is_err());
      assert!(supports_posix_rename(&[101, 0, 0, 0, 3]).is_err());
   }

   #[test]
   fn accepts_only_the_matching_successful_request_status() {
      let mut packet = vec![101];
      packet.extend_from_slice(&1_u32.to_be_bytes());
      packet.extend_from_slice(&0_u32.to_be_bytes());
      push_string(&mut packet, b"").unwrap();
      push_string(&mut packet, b"").unwrap();
      read_status(&packet).unwrap();
      packet[4] = 2;
      assert!(read_status(&packet).is_err());
      packet[4] = 1;
      packet[8] = 3;
      assert!(read_status(&packet).unwrap_err().contains("failed (3)"));
      packet[8] = 0;
      packet.pop();
      assert!(read_status(&packet).is_err());
   }
}
