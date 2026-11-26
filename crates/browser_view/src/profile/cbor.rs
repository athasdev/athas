//! The little CBOR WebAuthn needs: the attestation object and the COSE public key, both maps of
//! integers, text and bytes written in CTAP2's canonical order by whoever builds them.

pub enum Cbor {
    Int(i64),
    Bytes(Vec<u8>),
    Text(&'static str),
    Map(Vec<(Cbor, Cbor)>),
}

fn head(out: &mut Vec<u8>, major: u8, value: u64) {
    let major = major << 5;
    match value {
        0..=23 => out.push(major | value as u8),
        24..=0xff => out.extend([major | 24, value as u8]),
        0x100..=0xffff => {
            out.push(major | 25);
            out.extend((value as u16).to_be_bytes());
        }
        0x1_0000..=0xffff_ffff => {
            out.push(major | 26);
            out.extend((value as u32).to_be_bytes());
        }
        _ => {
            out.push(major | 27);
            out.extend(value.to_be_bytes());
        }
    }
}

impl Cbor {
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut Vec<u8>) {
        match self {
            Cbor::Int(value) if *value >= 0 => head(out, 0, *value as u64),
            Cbor::Int(value) => head(out, 1, (-1 - *value) as u64),
            Cbor::Bytes(bytes) => {
                head(out, 2, bytes.len() as u64);
                out.extend(bytes);
            }
            Cbor::Text(text) => {
                head(out, 3, text.len() as u64);
                out.extend(text.as_bytes());
            }
            Cbor::Map(entries) => {
                head(out, 5, entries.len() as u64);
                for (key, value) in entries {
                    key.write(out);
                    value.write(out);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_integers_text_and_bytes() {
        let map = Cbor::Map(vec![(Cbor::Int(1), Cbor::Int(2)), (Cbor::Int(3), Cbor::Int(-7)), (Cbor::Int(-1), Cbor::Int(1))]);
        assert_eq!(map.encode(), [0xa3, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01]);
        assert_eq!(Cbor::Text("fmt").encode(), [0x63, b'f', b'm', b't']);
        assert_eq!(Cbor::Bytes(vec![0; 32]).encode()[..2], [0x58, 32]);
        assert_eq!(Cbor::Int(500).encode(), [0x19, 0x01, 0xf4]);
        assert_eq!(Cbor::Map(Vec::new()).encode(), [0xa0]);
    }
}
