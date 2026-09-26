use aes::cipher::block_padding::NoPadding;
use aes::cipher::{BlockDecryptMut, KeyIvInit};
use base64::prelude::*;
use hmac::Hmac;
use pbkdf2::pbkdf2;
use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyringTunnel {
    pub individual_address: String,
    pub user_id: u8,
    pub password: String,
    pub authentication: Option<String>,
    pub host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyringDevice {
    pub individual_address: String,
    pub serial_number: Option<String>,
    pub tool_key: Option<String>,
    pub authentication: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecryptedKeyring {
    pub project_name: String,
    pub created: String,
    pub tunnels: Vec<KeyringTunnel>,
    pub devices: Vec<KeyringDevice>,
}

/// Derives the 16-byte AES-128 key from the keyring export password
pub fn derive_keyring_key(password: &str) -> [u8; 16] {
    let mut key = [0u8; 16];
    let salt = b"1.keyring.ets.knx.org";
    pbkdf2::<Hmac<Sha256>>(password.as_bytes(), salt, 65_536, &mut key).expect("PBKDF2 derivation");
    key
}

/// Computes the 16-byte IV from the Created attribute of the Keyring XML
pub fn derive_keyring_iv(created: &str) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(created.as_bytes());
    let result = hasher.finalize();
    let mut iv = [0u8; 16];
    iv.copy_from_slice(&result[..16]);
    iv
}

/// Decrypts a base64-encoded encrypted attribute from a .knxkeys XML file
pub fn decrypt_keyring_attribute(
    b64_cipher: &str,
    key: &[u8; 16],
    iv: &[u8; 16],
) -> Result<String, String> {
    let mut ciphertext = BASE64_STANDARD
        .decode(b64_cipher.trim())
        .map_err(|e| format!("Invalid base64 in attribute: {}", e))?;

    if ciphertext.len() < 16 || ciphertext.len() % 16 != 0 {
        return Err("Ciphertext length is not a valid AES-128 block multiple".to_string());
    }

    let decryptor = Aes128CbcDec::new(key.into(), iv.into());
    let decrypted = decryptor
        .decrypt_padded_mut::<NoPadding>(&mut ciphertext)
        .map_err(|e| format!("AES-128-CBC decryption failed: {:?}", e))?;

    if decrypted.len() < 9 {
        return Err("Decrypted data too short for KNX keyring format".to_string());
    }

    let pad_len = decrypted[decrypted.len() - 1] as usize;
    if pad_len == 0 || pad_len > 16 || 8 + pad_len > decrypted.len() {
        return Err("Invalid padding length in decrypted keyring attribute".to_string());
    }

    let pass_bytes = &decrypted[8..decrypted.len() - pad_len];
    String::from_utf8(pass_bytes.to_vec())
        .map_err(|_| "Decrypted attribute is not valid UTF-8 (wrong password?)".to_string())
}

/// Decrypts a binary attribute like ToolKey (returns hex string)
pub fn decrypt_keyring_binary_attribute(
    b64_cipher: &str,
    key: &[u8; 16],
    iv: &[u8; 16],
) -> Result<String, String> {
    let mut ciphertext = BASE64_STANDARD
        .decode(b64_cipher.trim())
        .map_err(|e| format!("Invalid base64: {}", e))?;

    if ciphertext.len() < 16 || ciphertext.len() % 16 != 0 {
        return Err("Invalid AES block size".to_string());
    }

    let decryptor = Aes128CbcDec::new(key.into(), iv.into());
    let decrypted = decryptor
        .decrypt_padded_mut::<NoPadding>(&mut ciphertext)
        .map_err(|e| format!("Decryption failed: {:?}", e))?;

    Ok(hex::encode(decrypted))
}

struct RawInterface {
    ia: String,
    user_id: u8,
    password_b64: Option<String>,
    auth_b64: Option<String>,
    host: Option<String>,
}

struct RawDevice {
    ia: String,
    serial: Option<String>,
    tool_key_b64: Option<String>,
    auth_b64: Option<String>,
}

/// Parses and decrypts a .knxkeys XML file with the given password
pub fn parse_and_decrypt_knxkeys(
    xml_content: &str,
    password: &str,
) -> Result<DecryptedKeyring, String> {
    let mut reader = Reader::from_str(xml_content);
    reader.config_mut().trim_text(true);

    let mut project_name = String::new();
    let mut created = String::new();
    let mut raw_interfaces = Vec::new();
    let mut raw_devices = Vec::new();

    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let name = String::from_utf8_lossy(e.name().into_inner()).to_string();
                if name.ends_with("Keyring") {
                    for attr in e.attributes().flatten() {
                        let key_str = String::from_utf8_lossy(attr.key.into_inner());
                        let val_str = String::from_utf8_lossy(&attr.value);
                        if key_str == "Project" {
                            project_name = val_str.to_string();
                        } else if key_str == "Created" {
                            created = val_str.to_string();
                        }
                    }
                } else if name.ends_with("Interface") {
                    let mut ia = String::new();
                    let mut user_id = 0u8;
                    let mut password_b64 = None;
                    let mut auth_b64 = None;
                    let mut host = None;
                    let mut iface_type = String::new();

                    for attr in e.attributes().flatten() {
                        let key_str = String::from_utf8_lossy(attr.key.into_inner());
                        let val_str = String::from_utf8_lossy(&attr.value);
                        match key_str.as_ref() {
                            "IndividualAddress" => ia = val_str.to_string(),
                            "UserID" => user_id = val_str.parse().unwrap_or(0),
                            "Password" => password_b64 = Some(val_str.to_string()),
                            "Authentication" => auth_b64 = Some(val_str.to_string()),
                            "Host" => host = Some(val_str.to_string()),
                            "Type" => iface_type = val_str.to_string(),
                            _ => {}
                        }
                    }

                    if iface_type == "Tunneling" && user_id > 0 {
                        raw_interfaces.push(RawInterface {
                            ia,
                            user_id,
                            password_b64,
                            auth_b64,
                            host,
                        });
                    }
                } else if name.ends_with("Device") {
                    let mut ia = String::new();
                    let mut serial = None;
                    let mut tool_key_b64 = None;
                    let mut auth_b64 = None;

                    for attr in e.attributes().flatten() {
                        let key_str = String::from_utf8_lossy(attr.key.into_inner());
                        let val_str = String::from_utf8_lossy(&attr.value);
                        match key_str.as_ref() {
                            "IndividualAddress" => ia = val_str.to_string(),
                            "SerialNumber" => serial = Some(val_str.to_string()),
                            "ToolKey" => tool_key_b64 = Some(val_str.to_string()),
                            "Authentication" => auth_b64 = Some(val_str.to_string()),
                            _ => {}
                        }
                    }

                    if !ia.is_empty() {
                        raw_devices.push(RawDevice {
                            ia,
                            serial,
                            tool_key_b64,
                            auth_b64,
                        });
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    if created.is_empty() {
        return Err("Invalid .knxkeys: Missing 'Created' timestamp attribute".to_string());
    }

    let key = derive_keyring_key(password);
    let iv = derive_keyring_iv(&created);

    let mut decrypted_tunnels = Vec::new();
    let mut decrypt_err_count = 0;

    for raw in raw_interfaces {
        if let Some(pass_b64) = raw.password_b64 {
            match decrypt_keyring_attribute(&pass_b64, &key, &iv) {
                Ok(plain_pass) => {
                    let plain_auth = raw
                        .auth_b64
                        .and_then(|a| decrypt_keyring_attribute(&a, &key, &iv).ok());

                    decrypted_tunnels.push(KeyringTunnel {
                        individual_address: raw.ia,
                        user_id: raw.user_id,
                        password: plain_pass,
                        authentication: plain_auth,
                        host: raw.host,
                    });
                }
                Err(_) => {
                    decrypt_err_count += 1;
                }
            }
        }
    }

    if decrypted_tunnels.is_empty() && decrypt_err_count > 0 {
        return Err("Entschlüsselung fehlgeschlagen: Das eingegebene Schlüsselbund-Passwort ist falsch.".to_string());
    }

    let mut decrypted_devices = Vec::new();
    for raw in raw_devices {
        let tool_key = raw
            .tool_key_b64
            .and_then(|tk| decrypt_keyring_binary_attribute(&tk, &key, &iv).ok());
        let auth = raw
            .auth_b64
            .and_then(|a| decrypt_keyring_attribute(&a, &key, &iv).ok());

        decrypted_devices.push(KeyringDevice {
            individual_address: raw.ia,
            serial_number: raw.serial,
            tool_key,
            authentication: auth,
        });
    }

    Ok(DecryptedKeyring {
        project_name,
        created,
        tunnels: decrypted_tunnels,
        devices: decrypted_devices,
    })
}

/// Scans standard locations for any .knxkeys files on the user machine
pub fn find_local_knxkeys_files() -> Vec<String> {
    let mut found = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();

    let candidates = [
        format!("{}/.konfix/gateway.knxkeys", home),
        format!("{}/.konfix/keyring.knxkeys", home),
        "gateway.knxkeys".to_string(),
        "keyring.knxkeys".to_string(),
    ];

    for path_str in candidates {
        if Path::new(&path_str).exists() {
            found.push(path_str);
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_and_iv_derivation() {
        let key = derive_keyring_key("testpassword");
        assert_eq!(key.len(), 16);

        let iv = derive_keyring_iv("2026-03-19T11:08:04");
        assert_eq!(iv.len(), 16);
    }
}
