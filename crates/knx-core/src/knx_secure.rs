use aes::cipher::generic_array::GenericArray;
use aes::cipher::{KeyInit, KeyIvInit, StreamCipher};
use ctr::Ctr128BE;
use hmac::Hmac;
use pbkdf2::pbkdf2;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::info;
use x25519_dalek::{PublicKey, StaticSecret};

pub const SERVICE_SECURE_WRAPPER: u16 = 0x0950;
pub const SERVICE_SESSION_REQUEST: u16 = 0x0951;
pub const SERVICE_SESSION_RESPONSE: u16 = 0x0952;
pub const SERVICE_SESSION_AUTHENTICATE: u16 = 0x0953;
pub const SERVICE_SESSION_STATUS: u16 = 0x0954;

pub const COUNTER_0_HANDSHAKE: [u8; 16] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF,
    0x00,
];

pub const CLIENT_SERIAL: [u8; 6] = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

pub use crate::model::KnxSecureCredentials;

/// Derives 16-byte key from device authentication password using PBKDF2-HMAC-SHA256
pub fn derive_device_authentication_password(password: &str) -> [u8; 16] {
    let salt = b"device-authentication-code.1.secure.ip.knx.org";
    let mut key = [0u8; 16];
    pbkdf2::<Hmac<Sha256>>(password.as_bytes(), salt, 65536, &mut key).expect("PBKDF2 failed");
    key
}

/// Derives 16-byte key from user password using PBKDF2-HMAC-SHA256
pub fn derive_user_password(password: &str) -> [u8; 16] {
    let salt = b"user-password.1.secure.ip.knx.org";
    let mut key = [0u8; 16];
    pbkdf2::<Hmac<Sha256>>(password.as_bytes(), salt, 65536, &mut key).expect("PBKDF2 failed");
    key
}

/// Computes AES-CBC MAC (last 16 bytes of CBC encryption with zero IV)
pub fn calculate_mac_cbc(
    key: &[u8; 16],
    additional_data: &[u8],
    payload: &[u8],
    block_0: &[u8; 16],
) -> [u8; 16] {
    let mut data = Vec::with_capacity(16 + 2 + additional_data.len() + payload.len() + 16);
    data.extend_from_slice(block_0);
    data.extend_from_slice(&(additional_data.len() as u16).to_be_bytes());
    data.extend_from_slice(additional_data);
    data.extend_from_slice(payload);

    // Zero-pad to multiple of 16 bytes
    let rem = data.len() % 16;
    if rem != 0 {
        data.resize(data.len() + (16 - rem), 0u8);
    }

    // Process blocks in-place
    use aes::cipher::BlockEncrypt;
    let aes_cipher = aes::Aes128::new(GenericArray::from_slice(key));
    let mut last_block = [0u8; 16];
    for chunk in data.chunks_exact_mut(16) {
        let mut block = GenericArray::clone_from_slice(chunk);
        // CBC XOR with previous ciphertext
        for i in 0..16 {
            block[i] ^= last_block[i];
        }
        aes_cipher.encrypt_block(&mut block);
        last_block.copy_from_slice(&block);
    }

    last_block
}

/// Encrypts data using AES-128-CTR mode
pub fn encrypt_ctr(
    key: &[u8; 16],
    counter_0: &[u8; 16],
    mac_cbc: &[u8; 16],
    payload: &[u8],
) -> (Vec<u8>, [u8; 16]) {
    let mut cipher = Ctr128BE::<aes::Aes128>::new(
        GenericArray::from_slice(key),
        GenericArray::from_slice(counter_0),
    );

    let mut enc_mac = *mac_cbc;
    cipher.apply_keystream(&mut enc_mac);

    let mut enc_payload = payload.to_vec();
    cipher.apply_keystream(&mut enc_payload);

    (enc_payload, enc_mac)
}

/// Decrypts data using AES-128-CTR mode
pub fn decrypt_ctr(
    key: &[u8; 16],
    counter_0: &[u8; 16],
    mac: &[u8; 16],
    payload: &[u8],
) -> (Vec<u8>, [u8; 16]) {
    let mut cipher = Ctr128BE::<aes::Aes128>::new(
        GenericArray::from_slice(key),
        GenericArray::from_slice(counter_0),
    );

    let mut dec_mac = *mac;
    cipher.apply_keystream(&mut dec_mac);

    let mut dec_payload = payload.to_vec();
    cipher.apply_keystream(&mut dec_payload);

    (dec_payload, dec_mac)
}

/// Generates X25519 client key pair
pub fn generate_ecdh_key_pair() -> (StaticSecret, [u8; 32]) {
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    (secret, *public.as_bytes())
}

/// Computes SHA256(shared_secret)[0..16] as the Session Key
pub fn compute_session_key(secret: &StaticSecret, peer_public: &[u8; 32]) -> [u8; 16] {
    let peer = PublicKey::from(*peer_public);
    let shared = secret.diffie_hellman(&peer);
    let hash = Sha256::digest(shared.as_bytes());
    let mut key = [0u8; 16];
    key.copy_from_slice(&hash[..16]);
    key
}

/// Wraps a plain KNX/IP packet inside SECURE_WRAPPER (0x0950)
pub fn wrap_secure_frame(
    session_key: &[u8; 16],
    session_id: u16,
    sequence_num: u64,
    serial_number: &[u8; 6],
    plain_frame: &[u8],
) -> Vec<u8> {
    let mut seq_info = [0u8; 6];
    let seq_bytes = sequence_num.to_be_bytes();
    seq_info.copy_from_slice(&seq_bytes[2..8]);

    let message_tag = [0x00, 0x00];

    // counter_0: sequence_info (6) + serial (6) + message_tag (2) + 0xFF 0x00 (2)
    let mut counter_0 = [0u8; 16];
    counter_0[0..6].copy_from_slice(&seq_info);
    counter_0[6..12].copy_from_slice(serial_number);
    counter_0[12..14].copy_from_slice(&message_tag);
    counter_0[14] = 0xFF;
    counter_0[15] = 0x00;

    // Additional data: Header (6) + session_id (2)
    let total_len = 6 + 16 + plain_frame.len() + 16;
    let mut header = [0u8; 6];
    header[0] = 0x06;
    header[1] = 0x10;
    header[2..4].copy_from_slice(&SERVICE_SECURE_WRAPPER.to_be_bytes());
    header[4..6].copy_from_slice(&(total_len as u16).to_be_bytes());

    let mut add_data = Vec::with_capacity(8);
    add_data.extend_from_slice(&header);
    add_data.extend_from_slice(&session_id.to_be_bytes());

    // block_0: sequence_info (6) + serial (6) + message_tag (2) + payload_len (2)
    let mut block_0 = [0u8; 16];
    block_0[0..6].copy_from_slice(&seq_info);
    block_0[6..12].copy_from_slice(serial_number);
    block_0[12..14].copy_from_slice(&message_tag);
    block_0[14..16].copy_from_slice(&(plain_frame.len() as u16).to_be_bytes());

    let mac_cbc = calculate_mac_cbc(session_key, &add_data, plain_frame, &block_0);
    let (enc_data, enc_mac) = encrypt_ctr(session_key, &counter_0, &mac_cbc, plain_frame);

    let mut packet = Vec::with_capacity(total_len);
    packet.extend_from_slice(&header);
    packet.extend_from_slice(&session_id.to_be_bytes());
    packet.extend_from_slice(&seq_info);
    packet.extend_from_slice(serial_number);
    packet.extend_from_slice(&message_tag);
    packet.extend_from_slice(&enc_data);
    packet.extend_from_slice(&enc_mac);

    packet
}

/// Unwraps and verifies a SECURE_WRAPPER (0x0950) packet
pub fn unwrap_secure_frame(
    session_key: &[u8; 16],
    session_id: u16,
    packet: &[u8],
) -> Result<Vec<u8>, String> {
    if packet.len() < 6 + 16 + 16 {
        return Err("SecureWrapper packet too short".to_string());
    }

    let pkt_session_id = u16::from_be_bytes([packet[6], packet[7]]);
    if pkt_session_id != session_id {
        return Err(format!(
            "Session ID mismatch: expected {}, got {}",
            session_id, pkt_session_id
        ));
    }

    let seq_info = &packet[8..14];
    let serial = &packet[14..20];
    let message_tag = &packet[20..22];

    let enc_payload_len = packet.len() - 6 - 16 - 16;
    let enc_payload = &packet[22..22 + enc_payload_len];
    let received_mac = &packet[packet.len() - 16..];

    let mut counter_0 = [0u8; 16];
    counter_0[0..6].copy_from_slice(seq_info);
    counter_0[6..12].copy_from_slice(serial);
    counter_0[12..14].copy_from_slice(message_tag);
    counter_0[14] = 0xFF;
    counter_0[15] = 0x00;

    let mut mac_arr = [0u8; 16];
    mac_arr.copy_from_slice(received_mac);

    let (dec_payload, mac_tr) = decrypt_ctr(session_key, &counter_0, &mac_arr, enc_payload);

    // Verify MAC
    let mut add_data = Vec::with_capacity(8);
    add_data.extend_from_slice(&packet[0..6]);
    add_data.extend_from_slice(&pkt_session_id.to_be_bytes());

    let mut block_0 = [0u8; 16];
    block_0[0..6].copy_from_slice(seq_info);
    block_0[6..12].copy_from_slice(serial);
    block_0[12..14].copy_from_slice(message_tag);
    block_0[14..16].copy_from_slice(&(dec_payload.len() as u16).to_be_bytes());

    let expected_mac = calculate_mac_cbc(session_key, &add_data, &dec_payload, &block_0);
    use subtle::ConstantTimeEq;
    if !bool::from(mac_tr.ct_eq(&expected_mac)) {
        return Err("SECURE_WRAPPER MAC verification failed".to_string());
    }

    Ok(dec_payload)
}

pub struct SecureEstablishedSession {
    pub stream: TcpStream,
    pub session_id: u16,
    pub session_key: [u8; 16],
    pub serial_number: [u8; 6],
}

/// Establishes and authenticates a KNXnet/IP Secure TCP session
pub async fn establish_secure_session(
    target_addr: SocketAddr,
    creds: &KnxSecureCredentials,
) -> Result<SecureEstablishedSession, String> {
    info!(
        "Initiating KNXnet/IP Secure TCP connection to {} (User ID: {})...",
        target_addr, creds.user_id
    );

    let mut stream = tokio::time::timeout(Duration::from_millis(4000), TcpStream::connect(target_addr))
        .await
        .map_err(|_| format!("Connection to {} timed out", target_addr))?
        .map_err(|e| format!("TCP connect error to {}: {}", target_addr, e))?;

    // 1. Generate ECDH key pair
    let (priv_key, client_pub_raw) = generate_ecdh_key_pair();

    // 2. Build and send SESSION_REQUEST (0x0951)
    // Header (6) + HPAI TCP (8) + Client ECDH Public Key (32) = 46 bytes
    let mut req_body = Vec::with_capacity(40);
    req_body.extend_from_slice(&[0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // HPAI IPV4_TCP
    req_body.extend_from_slice(&client_pub_raw);

    let total_len = 6 + req_body.len() as u16;
    let mut session_req_pkt = Vec::with_capacity(total_len as usize);
    session_req_pkt.extend_from_slice(&[0x06, 0x10, 0x09, 0x51]);
    session_req_pkt.extend_from_slice(&total_len.to_be_bytes());
    session_req_pkt.extend_from_slice(&req_body);

    stream
        .write_all(&session_req_pkt)
        .await
        .map_err(|e| format!("Failed to send SESSION_REQUEST: {}", e))?;

    // 3. Receive SESSION_RESPONSE (0x0952)
    let mut resp_hdr = [0u8; 6];
    tokio::time::timeout(Duration::from_millis(4000), stream.read_exact(&mut resp_hdr))
        .await
        .map_err(|_| "Gateway timed out waiting for SESSION_RESPONSE".to_string())?
        .map_err(|e| format!("Error receiving SESSION_RESPONSE header: {}", e))?;

    if resp_hdr[0] != 0x06 || resp_hdr[1] != 0x10 || resp_hdr[2] != 0x09 || resp_hdr[3] != 0x52 {
        return Err(format!(
            "Invalid SESSION_RESPONSE service identifier: 0x{:02X}{:02X}",
            resp_hdr[2], resp_hdr[3]
        ));
    }

    let total_resp_len = u16::from_be_bytes([resp_hdr[4], resp_hdr[5]]) as usize;
    if total_resp_len < 56 {
        return Err("SESSION_RESPONSE too short".to_string());
    }

    let mut resp_body = vec![0u8; total_resp_len - 6];
    stream
        .read_exact(&mut resp_body)
        .await
        .map_err(|e| format!("Error receiving SESSION_RESPONSE body: {}", e))?;

    let session_id = u16::from_be_bytes([resp_body[0], resp_body[1]]);
    let mut server_pub_raw = [0u8; 32];
    server_pub_raw.copy_from_slice(&resp_body[2..34]);

    // 4. Compute session key
    let session_key = compute_session_key(&priv_key, &server_pub_raw);

    // 5. Build SESSION_AUTHENTICATE (0x0953)
    let user_pwd_key = derive_user_password(&creds.user_password);

    let mut pub_keys_xor = [0u8; 32];
    for i in 0..32 {
        pub_keys_xor[i] = client_pub_raw[i] ^ server_pub_raw[i];
    }

    let auth_hdr = [0x06, 0x10, 0x09, 0x53, 0x00, 0x18];
    let mut add_data = Vec::with_capacity(6 + 2 + 32);
    add_data.extend_from_slice(&auth_hdr);
    add_data.push(0x00); // reserved
    add_data.push(creds.user_id);
    add_data.extend_from_slice(&pub_keys_xor);

    let block_0 = [0u8; 16];
    let auth_mac_cbc = calculate_mac_cbc(&user_pwd_key, &add_data, &[], &block_0);
    let (_, auth_mac) = encrypt_ctr(&user_pwd_key, &COUNTER_0_HANDSHAKE, &auth_mac_cbc, &[]);

    let mut auth_frame = Vec::with_capacity(24);
    auth_frame.extend_from_slice(&auth_hdr);
    auth_frame.push(0x00);
    auth_frame.push(creds.user_id);
    auth_frame.extend_from_slice(&auth_mac);

    // Wrap and send SESSION_AUTHENTICATE in SECURE_WRAPPER with seq=0
    let wrapped_auth = wrap_secure_frame(
        &session_key,
        session_id,
        0,
        &CLIENT_SERIAL,
        &auth_frame,
    );

    stream
        .write_all(&wrapped_auth)
        .await
        .map_err(|e| format!("Failed to send wrapped SESSION_AUTHENTICATE: {}", e))?;

    // 6. Receive SESSION_STATUS (0x0954) inside SECURE_WRAPPER
    let mut wrap_hdr = [0u8; 6];
    tokio::time::timeout(Duration::from_millis(4000), stream.read_exact(&mut wrap_hdr))
        .await
        .map_err(|_| "Gateway timed out waiting for SESSION_STATUS".to_string())?
        .map_err(|e| format!("Error receiving SECURE_WRAPPER header: {}", e))?;

    let wrap_len = u16::from_be_bytes([wrap_hdr[4], wrap_hdr[5]]) as usize;
    if wrap_len < 6 + 16 + 16 {
        return Err("SECURE_WRAPPER for SESSION_STATUS too short".to_string());
    }

    let mut wrap_rest = vec![0u8; wrap_len - 6];
    stream
        .read_exact(&mut wrap_rest)
        .await
        .map_err(|e| format!("Error reading SECURE_WRAPPER body: {}", e))?;

    let mut full_wrap_pkt = Vec::with_capacity(wrap_len);
    full_wrap_pkt.extend_from_slice(&wrap_hdr);
    full_wrap_pkt.extend_from_slice(&wrap_rest);

    let mut serial_number = [0u8; 6];
    serial_number.copy_from_slice(&full_wrap_pkt[14..20]);

    let dec_status_frame = unwrap_secure_frame(&session_key, session_id, &full_wrap_pkt)
        .map_err(|e| format!("Failed to decrypt SESSION_STATUS: {}", e))?;

    if dec_status_frame.len() < 8
        || dec_status_frame[0] != 0x06
        || dec_status_frame[1] != 0x10
        || dec_status_frame[2] != 0x09
        || dec_status_frame[3] != 0x54
    {
        return Err("Expected SESSION_STATUS response frame".to_string());
    }

    let status_code = dec_status_frame[6];
    if status_code != 0x00 {
        let err_desc = match status_code {
            0x01 => "STATUS_AUTHENTICATION_FAILED: Authentifizierung abgelehnt. User-ID oder Passwort falsch oder Tunnel belegt.",
            0x02 => "STATUS_UNAUTHENTICATED: Sitzung noch nicht authentifiziert.",
            0x03 => "STATUS_TIMEOUT: Zeitüberschreitung während des Handshakes.",
            _ => "Unbekannter Fehlercode",
        };
        return Err(format!("KNX Secure Authentifizierung fehlgeschlagen: 0x{:02X} ({})", status_code, err_desc));
    }

    info!(
        "KNXnet/IP Secure Session #{} established with device serial {:02X}:{:02X}:{:02X}:{:02X}:{:02X}:{:02X}",
        session_id,
        serial_number[0], serial_number[1], serial_number[2], serial_number[3], serial_number[4], serial_number[5]
    );

    Ok(SecureEstablishedSession {
        stream,
        session_id,
        session_key,
        serial_number,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_derivation() {
        let dev_key = derive_device_authentication_password("test");
        assert_eq!(
            hex::encode(dev_key),
            "0dcf7c0a376789ceb3a600235e7c24b4"
        );

        let user_key = derive_user_password("test");
        assert_eq!(
            hex::encode(user_key),
            "422184f2dc19eeb6b8bf2c08c8ee8c00"
        );
    }

    #[test]
    fn test_calculate_mac_cbc() {
        let key = hex::decode("0dcf7c0a376789ceb3a600235e7c24b4").unwrap();
        let mut key_arr = [0u8; 16];
        key_arr.copy_from_slice(&key);

        let add_data = hex::decode("0610095200380002").unwrap();
        let block_0 = [0u8; 16];

        let mac = calculate_mac_cbc(&key_arr, &add_data, &[], &block_0);
        assert_eq!(hex::encode(mac), "711e2c6fbb7d969b2757e1853cdb5e00");
    }

    #[test]
    fn test_secure_frame_wrap_unwrap_roundtrip() {
        let key = [0x42u8; 16];
        let session_id = 7;
        let seq = 1;
        let serial = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
        let plain = b"Hello KNX IP Secure World!";

        let wrapped = wrap_secure_frame(&key, session_id, seq, &serial, plain);
        let unwrapped = unwrap_secure_frame(&key, session_id, &wrapped).expect("unwrap failed");
        assert_eq!(unwrapped, plain);
    }
}
