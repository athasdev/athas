//! The authenticator behind `navigator.credentials` in browser tabs.
//!
//! WKWebView answers WebAuthn only for apps Apple grants the browser entitlement, so pages in
//! Athas would never see a passkey. Athas answers instead, as a password manager's extension
//! does: the page script hands the request over, Athas checks it against the page's real
//! address, asks the user, and signs with a P-256 key it keeps in the keychain. Attestation is
//! always `none`, which every site accepts for passkeys.
//!
//! Nothing a page sends is trusted: the origin is read from the webview, and a relying party may
//! only be the page's own host or a registrable domain above it.

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use p256::ecdsa::{Signature, SigningKey, signature::Signer as _};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use url::Url;

use super::cbor::Cbor;

/// COSE algorithm ES256: ECDSA on P-256 with SHA-256.
const ES256: i64 = -7;

/// The DER `SubjectPublicKeyInfo` header of an uncompressed P-256 key: id-ecPublicKey, prime256v1.
const P256_SPKI_PREFIX: [u8; 26] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01,
    0x07, 0x03, 0x42, 0x00,
];

const FLAG_USER_PRESENT: u8 = 0x01;
const FLAG_USER_VERIFIED: u8 = 0x04;
const FLAG_ATTESTED_DATA: u8 = 0x40;

/// Why a ceremony failed, as the `DOMException` the page sees.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebAuthnError {
    pub name: &'static str,
    pub message: String,
}

impl WebAuthnError {
    pub fn new(name: &'static str, message: impl Into<String>) -> Self {
        Self { name, message: message.into() }
    }

    /// The user said no, or there was nothing to say yes to.
    pub fn not_allowed() -> Self {
        Self::new("NotAllowedError", "The operation either timed out or was not allowed.")
    }

    fn security(message: impl Into<String>) -> Self {
        Self::new("SecurityError", message)
    }

    pub fn to_json(&self) -> Value {
        json!({ "name": self.name, "message": self.message })
    }
}

pub type Result<T> = std::result::Result<T, WebAuthnError>;

mod base64url {
    use super::*;

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&URL_SAFE_NO_PAD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Vec<u8>, D::Error> {
        let text = String::deserialize(deserializer)?;
        decode(&text).ok_or_else(|| serde::de::Error::custom("invalid base64url"))
    }
}

/// Pages send buffers as base64url; some libraries pad them or use the standard alphabet.
fn decode(text: &str) -> Option<Vec<u8>> {
    let text: String = text.trim_end_matches('=').chars().map(|c| match c {
        '+' => '-',
        '/' => '_',
        c => c,
    }).collect();
    URL_SAFE_NO_PAD.decode(text).ok()
}

fn encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// A passkey Athas made for a site.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Passkey {
    #[serde(with = "base64url")]
    pub credential_id: Vec<u8>,
    pub rp_id: String,
    #[serde(default)]
    pub rp_name: String,
    #[serde(with = "base64url")]
    pub user_handle: Vec<u8>,
    pub user_name: String,
    #[serde(default)]
    pub display_name: String,
    /// The P-256 secret scalar.
    #[serde(with = "base64url")]
    pub private_key: Vec<u8>,
    /// Seconds since the Unix epoch.
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<u64>,
}

impl Passkey {
    /// The name to show for the account: the user name, else the display name.
    pub fn account_name(&self) -> &str {
        if self.user_name.trim().is_empty() { &self.display_name } else { &self.user_name }
    }

    fn signing_key(&self) -> Result<SigningKey> {
        SigningKey::from_slice(&self.private_key).map_err(|_| WebAuthnError::new("UnknownError", "The passkey's key is damaged."))
    }
}

/// The page's origin, if a passkey may be used on it: https, or http on localhost.
pub fn page_origin(url: &str) -> Result<Url> {
    let url = Url::parse(url).map_err(|_| WebAuthnError::security("The page has no valid address."))?;
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let local = host == "localhost" || host.ends_with(".localhost");
    match url.scheme() {
        "https" => Ok(url),
        "http" if local => Ok(url),
        _ => Err(WebAuthnError::security("Passkeys need a secure page (https).")),
    }
}

/// The origin string WebAuthn signs: scheme, host and a port other than the default.
fn origin_string(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// The relying party a page may name: its host, or a registrable domain above it.
pub fn relying_party(origin: &Url, requested: Option<&str>) -> Result<String> {
    let host = match origin.host() {
        Some(url::Host::Domain(domain)) => domain.to_ascii_lowercase(),
        _ => return Err(WebAuthnError::security("Passkeys need a domain name, not an IP address.")),
    };
    let Some(requested) = requested.map(|id| id.trim().to_ascii_lowercase()).filter(|id| !id.is_empty()) else {
        return Ok(host);
    };
    let within = host == requested || host.ends_with(&format!(".{requested}"));
    let local = requested == "localhost";
    let public_suffix = !local && psl::suffix_str(&requested).is_none_or(|suffix| suffix == requested);
    if !within || public_suffix {
        return Err(WebAuthnError::security(format!("{requested} is not a valid relying party for {host}.")));
    }
    Ok(requested)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Ceremony {
    Create,
    Get,
}

/// `CollectedClientData`, in the member order browsers write it.
fn client_data(ceremony: Ceremony, challenge: &[u8], origin: &Url) -> Vec<u8> {
    let kind = match ceremony {
        Ceremony::Create => "webauthn.create",
        Ceremony::Get => "webauthn.get",
    };
    let origin = serde_json::to_string(&origin_string(origin)).unwrap_or_default();
    format!(r#"{{"type":"{kind}","challenge":"{}","origin":{origin},"crossOrigin":false}}"#, encode(challenge)).into_bytes()
}

fn authenticator_data(rp_id: &str, flags: u8, attested: Option<&[u8]>) -> Vec<u8> {
    let mut data = Sha256::digest(rp_id.as_bytes()).to_vec();
    data.push(flags | if attested.is_some() { FLAG_ATTESTED_DATA } else { 0 });
    // A passkey kept in one place has no clone to catch, so its counter stays at 0, as the
    // platform authenticators' do.
    data.extend(0u32.to_be_bytes());
    if let Some(attested) = attested {
        data.extend(attested);
    }
    data
}

fn flags(verified: bool) -> u8 {
    FLAG_USER_PRESENT | if verified { FLAG_USER_VERIFIED } else { 0 }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelyingParty {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct User {
    pub handle: Vec<u8>,
    pub name: String,
    pub display_name: String,
}

/// A page asking for a new passkey, checked against its origin.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreationRequest {
    origin: Url,
    challenge: Vec<u8>,
    pub rp: RelyingParty,
    pub user: User,
    excluded: Vec<Vec<u8>>,
    cred_props: bool,
}

/// A page asking to sign in with a passkey, checked against its origin.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssertionRequest {
    origin: Url,
    challenge: Vec<u8>,
    pub rp_id: String,
    allowed: Vec<Vec<u8>>,
}

fn bytes_field(value: &Value, field: &str) -> Result<Vec<u8>> {
    value
        .get(field)
        .and_then(Value::as_str)
        .and_then(decode)
        .ok_or_else(|| WebAuthnError::new("TypeError", format!("Missing or invalid {field}.")))
}

fn credential_ids(value: Option<&Value>) -> Vec<Vec<u8>> {
    value
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|descriptor| descriptor.get("type").and_then(Value::as_str).is_none_or(|kind| kind == "public-key"))
                .filter_map(|descriptor| descriptor.get("id").and_then(Value::as_str).and_then(decode))
                .collect()
        })
        .unwrap_or_default()
}

fn text(value: &Value, field: &str) -> String {
    value.get(field).and_then(Value::as_str).unwrap_or_default().trim().to_string()
}

impl CreationRequest {
    /// Reads `PublicKeyCredentialCreationOptions` as the page script sent them.
    pub fn parse(page_url: &str, options: &Value) -> Result<Self> {
        let origin = page_origin(page_url)?;
        let rp = options.get("rp").ok_or_else(|| WebAuthnError::new("TypeError", "Missing rp."))?;
        let rp_id = relying_party(&origin, rp.get("id").and_then(Value::as_str))?;
        let user = options.get("user").ok_or_else(|| WebAuthnError::new("TypeError", "Missing user."))?;
        let handle = bytes_field(user, "id")?;
        if handle.is_empty() || handle.len() > 64 {
            return Err(WebAuthnError::new("TypeError", "The user handle must be 1 to 64 bytes."));
        }
        let algorithms: Vec<i64> = options
            .get("pubKeyCredParams")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(|param| param.get("alg").and_then(Value::as_i64)).collect())
            .unwrap_or_default();
        // An empty list means the defaults, which start with ES256.
        if !algorithms.is_empty() && !algorithms.contains(&ES256) {
            return Err(WebAuthnError::new("NotSupportedError", "Athas passkeys use ES256, which this site doesn't accept."));
        }
        let rp_name = text(rp, "name");
        Ok(Self {
            challenge: bytes_field(options, "challenge")?,
            rp: RelyingParty { name: if rp_name.is_empty() { rp_id.clone() } else { rp_name }, id: rp_id },
            user: User { handle, name: text(user, "name"), display_name: text(user, "displayName") },
            excluded: credential_ids(options.get("excludeCredentials")),
            cred_props: options.pointer("/extensions/credProps").and_then(Value::as_bool).unwrap_or(false),
            origin,
        })
    }

    /// The site already has one of these passkeys, so it asked for no second one.
    pub fn is_excluded(&self, passkeys: &[Passkey]) -> bool {
        passkeys.iter().any(|passkey| passkey.rp_id == self.rp.id && self.excluded.contains(&passkey.credential_id))
    }

    /// The passkey this replaces: one for the same account on the same site.
    pub fn replaces<'a>(&self, passkeys: &'a [Passkey]) -> Option<&'a Passkey> {
        passkeys.iter().find(|passkey| passkey.rp_id == self.rp.id && passkey.user_handle == self.user.handle)
    }

    /// Makes the passkey and the `RegistrationResponseJSON` the page receives.
    pub fn create(&self, verified: bool, now: u64) -> Result<(Passkey, Value)> {
        let signing_key = random_signing_key()?;
        let credential_id = random_bytes::<16>()?.to_vec();
        let public_key = signing_key.verifying_key();
        let point = public_key.to_encoded_point(false);
        let (Some(x), Some(y)) = (point.x(), point.y()) else {
            return Err(WebAuthnError::new("UnknownError", "Failed to make a key."));
        };
        let cose_key = Cbor::Map(vec![
            (Cbor::Int(1), Cbor::Int(2)),
            (Cbor::Int(3), Cbor::Int(ES256)),
            (Cbor::Int(-1), Cbor::Int(1)),
            (Cbor::Int(-2), Cbor::Bytes(x.to_vec())),
            (Cbor::Int(-3), Cbor::Bytes(y.to_vec())),
        ])
        .encode();
        let mut attested = vec![0u8; 16];
        attested.extend((credential_id.len() as u16).to_be_bytes());
        attested.extend(&credential_id);
        attested.extend(&cose_key);
        let auth_data = authenticator_data(&self.rp.id, flags(verified), Some(&attested));
        let attestation_object = Cbor::Map(vec![
            (Cbor::Text("fmt"), Cbor::Text("none")),
            (Cbor::Text("attStmt"), Cbor::Map(Vec::new())),
            (Cbor::Text("authData"), Cbor::Bytes(auth_data.clone())),
        ])
        .encode();
        let mut spki = P256_SPKI_PREFIX.to_vec();
        spki.extend(point.as_bytes());
        let client_data = client_data(Ceremony::Create, &self.challenge, &self.origin);
        let mut extensions = json!({});
        if self.cred_props {
            extensions["credProps"] = json!({ "rk": true });
        }
        let response = json!({
            "id": encode(&credential_id),
            "rawId": encode(&credential_id),
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "response": {
                "clientDataJSON": encode(&client_data),
                "attestationObject": encode(&attestation_object),
                "authenticatorData": encode(&auth_data),
                "publicKey": encode(&spki),
                "publicKeyAlgorithm": ES256,
                "transports": ["internal"],
            },
            "clientExtensionResults": extensions,
        });
        let passkey = Passkey {
            credential_id,
            rp_id: self.rp.id.clone(),
            rp_name: self.rp.name.clone(),
            user_handle: self.user.handle.clone(),
            user_name: self.user.name.clone(),
            display_name: self.user.display_name.clone(),
            private_key: signing_key.to_bytes().to_vec(),
            created_at: now,
            last_used_at: None,
        };
        Ok((passkey, response))
    }
}

impl AssertionRequest {
    /// Reads `PublicKeyCredentialRequestOptions` as the page script sent them.
    pub fn parse(page_url: &str, options: &Value) -> Result<Self> {
        let origin = page_origin(page_url)?;
        Ok(Self {
            rp_id: relying_party(&origin, options.get("rpId").and_then(Value::as_str))?,
            challenge: bytes_field(options, "challenge")?,
            allowed: credential_ids(options.get("allowCredentials")),
            origin,
        })
    }

    /// The passkeys the page would take, most recently used first.
    pub fn candidates<'a>(&self, passkeys: &'a [Passkey]) -> Vec<&'a Passkey> {
        let mut candidates: Vec<&Passkey> = passkeys
            .iter()
            .filter(|passkey| passkey.rp_id == self.rp_id && (self.allowed.is_empty() || self.allowed.contains(&passkey.credential_id)))
            .collect();
        candidates.sort_by_key(|passkey| std::cmp::Reverse(passkey.last_used_at.unwrap_or(passkey.created_at)));
        candidates
    }

    /// Signs the challenge with `passkey`: the `AuthenticationResponseJSON` the page receives.
    pub fn sign(&self, passkey: &Passkey, verified: bool) -> Result<Value> {
        if passkey.rp_id != self.rp_id {
            return Err(WebAuthnError::not_allowed());
        }
        let auth_data = authenticator_data(&self.rp_id, flags(verified), None);
        let client_data = client_data(Ceremony::Get, &self.challenge, &self.origin);
        let mut signed = auth_data.clone();
        signed.extend(Sha256::digest(&client_data));
        let signature: Signature = passkey.signing_key()?.sign(&signed);
        Ok(json!({
            "id": encode(&passkey.credential_id),
            "rawId": encode(&passkey.credential_id),
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "response": {
                "clientDataJSON": encode(&client_data),
                "authenticatorData": encode(&auth_data),
                "signature": encode(signature.to_der().as_bytes()),
                "userHandle": encode(&passkey.user_handle),
            },
            "clientExtensionResults": {},
        }))
    }
}

fn random_bytes<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::getrandom(&mut bytes).map_err(|_| WebAuthnError::new("UnknownError", "No secure randomness available."))?;
    Ok(bytes)
}

fn random_signing_key() -> Result<SigningKey> {
    // A random scalar is out of range about once in 2^32 draws.
    for _ in 0..8 {
        if let Ok(key) = SigningKey::from_slice(&random_bytes::<32>()?) {
            return Ok(key);
        }
    }
    Err(WebAuthnError::new("UnknownError", "Failed to make a key."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{VerifyingKey, signature::Verifier as _};

    fn creation_options() -> Value {
        json!({
            "rp": { "id": "github.com", "name": "GitHub" },
            "user": { "id": encode(b"user-1"), "name": "octocat", "displayName": "The Octocat" },
            "challenge": encode(b"challenge-1"),
            "pubKeyCredParams": [{ "type": "public-key", "alg": -8 }, { "type": "public-key", "alg": -7 }],
            "extensions": { "credProps": true },
        })
    }

    #[test]
    fn a_page_names_only_its_own_domain() {
        let origin = page_origin("https://login.example.co.uk/path").unwrap();
        assert_eq!(relying_party(&origin, None).unwrap(), "login.example.co.uk");
        assert_eq!(relying_party(&origin, Some("Example.co.uk")).unwrap(), "example.co.uk");
        assert!(relying_party(&origin, Some("co.uk")).is_err());
        assert!(relying_party(&origin, Some("other.com")).is_err());
        assert!(relying_party(&origin, Some("ample.co.uk")).is_err());
        let local = page_origin("http://localhost:5173").unwrap();
        assert_eq!(relying_party(&local, Some("localhost")).unwrap(), "localhost");
        assert!(page_origin("http://example.com").is_err());
        assert!(page_origin("file:///tmp/a.html").is_err());
        assert!(relying_party(&page_origin("https://127.0.0.1").unwrap(), None).is_err());
    }

    #[test]
    fn makes_a_passkey_and_signs_in_with_it() {
        let request = CreationRequest::parse("https://github.com/login", &creation_options()).unwrap();
        assert_eq!(request.rp.name, "GitHub");
        assert_eq!(request.user.name, "octocat");
        let (passkey, response) = request.create(true, 100).unwrap();
        assert_eq!(passkey.rp_id, "github.com");
        assert_eq!(response["response"]["publicKeyAlgorithm"], ES256);
        assert_eq!(response["clientExtensionResults"]["credProps"]["rk"], true);

        let client_data: Value =
            serde_json::from_slice(&decode(response["response"]["clientDataJSON"].as_str().unwrap()).unwrap()).unwrap();
        assert_eq!(client_data["type"], "webauthn.create");
        assert_eq!(client_data["origin"], "https://github.com");
        assert_eq!(client_data["challenge"], encode(b"challenge-1"));

        let auth_data = decode(response["response"]["authenticatorData"].as_str().unwrap()).unwrap();
        assert_eq!(auth_data[..32], Sha256::digest(b"github.com")[..]);
        assert_eq!(auth_data[32], FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_DATA);
        assert_eq!(u16::from_be_bytes([auth_data[53], auth_data[54]]), 16);
        assert_eq!(auth_data[55..71], passkey.credential_id[..]);

        let get = AssertionRequest::parse(
            "https://github.com/session",
            &json!({ "challenge": encode(b"challenge-2"), "rpId": "github.com", "allowCredentials": [] }),
        )
        .unwrap();
        let passkeys = vec![passkey.clone()];
        assert_eq!(get.candidates(&passkeys).len(), 1);
        let assertion = get.sign(&passkey, false).unwrap();
        let auth_data = decode(assertion["response"]["authenticatorData"].as_str().unwrap()).unwrap();
        assert_eq!(auth_data.len(), 37);
        assert_eq!(auth_data[32], FLAG_USER_PRESENT);
        let client_data = decode(assertion["response"]["clientDataJSON"].as_str().unwrap()).unwrap();
        let mut signed = auth_data.clone();
        signed.extend(Sha256::digest(&client_data));
        let signature = Signature::from_der(&decode(assertion["response"]["signature"].as_str().unwrap()).unwrap()).unwrap();
        let spki = decode(response["response"]["publicKey"].as_str().unwrap()).unwrap();
        assert_eq!(spki[..26], P256_SPKI_PREFIX);
        let public_key = VerifyingKey::from_sec1_bytes(&spki[26..]).unwrap();
        assert!(public_key.verify(&signed, &signature).is_ok());
        assert_eq!(assertion["response"]["userHandle"], encode(b"user-1"));
    }

    #[test]
    fn honours_the_lists_a_site_sends() {
        let request = CreationRequest::parse("https://github.com", &creation_options()).unwrap();
        let (passkey, _) = request.create(true, 1).unwrap();
        let passkeys = vec![passkey.clone()];
        let mut options = creation_options();
        options["excludeCredentials"] = json!([{ "type": "public-key", "id": encode(&passkey.credential_id) }]);
        assert!(CreationRequest::parse("https://github.com", &options).unwrap().is_excluded(&passkeys));
        assert!(request.replaces(&passkeys).is_some());

        let other = AssertionRequest::parse(
            "https://github.com",
            &json!({ "challenge": encode(b"c"), "allowCredentials": [{ "type": "public-key", "id": encode(b"another") }] }),
        )
        .unwrap();
        assert!(other.candidates(&passkeys).is_empty());
        let elsewhere = AssertionRequest::parse("https://gitlab.com", &json!({ "challenge": encode(b"c") })).unwrap();
        assert!(elsewhere.candidates(&passkeys).is_empty());
        assert!(elsewhere.sign(&passkey, true).is_err());
    }

    #[test]
    fn refuses_what_it_cannot_make() {
        let mut options = creation_options();
        options["pubKeyCredParams"] = json!([{ "type": "public-key", "alg": -257 }]);
        assert_eq!(CreationRequest::parse("https://github.com", &options).unwrap_err().name, "NotSupportedError");
        let mut options = creation_options();
        options["rp"]["id"] = json!("gitlab.com");
        assert_eq!(CreationRequest::parse("https://github.com", &options).unwrap_err().name, "SecurityError");
    }

    #[test]
    fn reads_padded_and_standard_base64() {
        assert_eq!(decode("YQ==").unwrap(), b"a");
        assert_eq!(decode("-_8").unwrap(), decode("+/8=").unwrap());
    }
}
