use aes::cipher::generic_array::GenericArray;
use aes::cipher::{KeyIvInit, StreamCipher};
use ctr::Ctr128BE;
use rand::RngCore;
use sha2::{Digest, Sha256};
use crate::model::KnxDataSecureConfig;

pub const KNX_DATA_SECURE_MAC_LEN: usize = 4;

/// Generates a cryptographically secure 16-byte Tool-Key formatted as 32 hex characters
pub fn generate_tool_key() -> String {
    let mut key = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut key);
    hex::encode(key)
}

/// Parses a Factory Default Setup Key (FDSK) into a 16-byte AES key.
/// Accepts:
/// 1. 32-char hex string (e.g. "a1b2c3d4e5f60718293a4b5c6d7e8f90")
/// 2. Hyphenated standard string (e.g. "01234-56789-ABCDE-FGHIJ-KLMNO-PQRST")
pub fn parse_fdsk(input: &str) -> Result<[u8; 16], String> {
    let cleaned: String = input.chars().filter(|c| c.is_alphanumeric()).collect();
    if cleaned.is_empty() {
        return Err("FDSK darf nicht leer sein".to_string());
    }

    if cleaned.len() == 32 {
        if let Ok(bytes) = hex::decode(&cleaned) {
            let mut key = [0u8; 16];
            key.copy_from_slice(&bytes[..16]);
            return Ok(key);
        }
    }

    // Standard KNX FDSK string: Hash to 16 bytes via SHA-256 for consistent derivation
    let hash = Sha256::digest(cleaned.as_bytes());
    let mut key = [0u8; 16];
    key.copy_from_slice(&hash[..16]);
    Ok(key)
}

/// Builds the 12-byte Nonce for KNX Data Secure on TP according to AN159 / ISO 22510.
pub fn build_tp_data_secure_nonce(
    source_ia: u16,
    sequence_counter_48: u64,
    scb: u8,
) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    // Bytes 0..1: Source Individual Address
    nonce[0..2].copy_from_slice(&source_ia.to_be_bytes());
    // Bytes 2..7: 48-bit Sequence Counter (6 bytes)
    let seq_bytes = sequence_counter_48.to_be_bytes();
    nonce[2..8].copy_from_slice(&seq_bytes[2..8]);
    // Byte 8: Security Control Byte
    nonce[8] = scb;
    // Bytes 9..11: Reserved / Zero
    nonce[9] = 0;
    nonce[10] = 0;
    nonce[11] = 0;
    nonce
}

/// Encrypts an APDU payload using AES-128-CCM with a 4-byte MAC.
/// Returns: (Ciphertext, 4-byte MAC)
pub fn encrypt_tp_data_secure(
    key: &[u8; 16],
    nonce: &[u8; 12],
    additional_data: &[u8],
    plaintext: &[u8],
) -> (Vec<u8>, [u8; 4]) {
    // 1. Construct Block 0 for CCM MAC computation
    // Flags: has_aad = 1, M' = (4 - 2)/2 = 1, L' = 15 - 1 - 12 = 2 -> (1 << 6) | (1 << 3) | 2 = 0x4A
    let mut block_0 = [0u8; 16];
    block_0[0] = 0x4A;
    block_0[1..13].copy_from_slice(nonce);
    block_0[14..16].copy_from_slice(&(plaintext.len() as u16).to_be_bytes());

    // 2. Compute 16-byte CBC-MAC
    let mac_cbc_full = crate::knx_secure::calculate_mac_cbc(key, additional_data, plaintext, &block_0);

    // 3. Construct Counter 0 for CTR mode: Flags (L' = 2 -> 0x02) + Nonce + Counter 0 (0x0000)
    let mut counter_0 = [0u8; 16];
    counter_0[0] = 0x02;
    counter_0[1..13].copy_from_slice(nonce);
    counter_0[14] = 0x00;
    counter_0[15] = 0x00;

    // 4. Encrypt MAC and Plaintext using CTR mode
    let mut cipher = Ctr128BE::<aes::Aes128>::new(
        GenericArray::from_slice(key),
        GenericArray::from_slice(&counter_0),
    );

    let mut enc_mac_16 = mac_cbc_full;
    cipher.apply_keystream(&mut enc_mac_16);

    let mut ciphertext = plaintext.to_vec();
    cipher.apply_keystream(&mut ciphertext);

    // Truncate encrypted MAC to 4 bytes
    let mut mac_4 = [0u8; 4];
    mac_4.copy_from_slice(&enc_mac_16[..4]);

    (ciphertext, mac_4)
}

/// Decrypts a KNX Data Secure TP payload and verifies the 4-byte MAC.
pub fn decrypt_tp_data_secure(
    key: &[u8; 16],
    nonce: &[u8; 12],
    additional_data: &[u8],
    ciphertext: &[u8],
    mac_4: &[u8; 4],
) -> Result<Vec<u8>, String> {
    // 1. Construct Counter 0 for CTR mode
    let mut counter_0 = [0u8; 16];
    counter_0[0] = 0x02;
    counter_0[1..13].copy_from_slice(nonce);
    counter_0[14] = 0x00;
    counter_0[15] = 0x00;

    // Decrypt MAC0 keystream block
    let mut cipher = Ctr128BE::<aes::Aes128>::new(
        GenericArray::from_slice(key),
        GenericArray::from_slice(&counter_0),
    );

    let mut s_0 = [0u8; 16];
    cipher.apply_keystream(&mut s_0);

    // Decrypt ciphertext
    let mut plaintext = ciphertext.to_vec();
    cipher.apply_keystream(&mut plaintext);

    // 2. Re-compute CBC-MAC over decrypted plaintext
    let mut block_0 = [0u8; 16];
    block_0[0] = 0x4A;
    block_0[1..13].copy_from_slice(nonce);
    block_0[14..16].copy_from_slice(&(plaintext.len() as u16).to_be_bytes());

    let computed_cbc_full = crate::knx_secure::calculate_mac_cbc(key, additional_data, &plaintext, &block_0);

    // 3. Encrypt computed MAC with s_0 and compare first 4 bytes
    let mut expected_enc_mac = computed_cbc_full;
    for i in 0..4 {
        expected_enc_mac[i] ^= s_0[i];
    }

    if expected_enc_mac[..4] == mac_4[..] {
        Ok(plaintext)
    } else {
        Err("KNX Data Secure MAC-Fehler (Integritätsprüfung fehlgeschlagen)".to_string())
    }
}

/// Initializes or returns existing security config for a device
pub fn ensure_device_security(config: &mut Option<KnxDataSecureConfig>) -> &mut KnxDataSecureConfig {
    if config.is_none() {
        *config = Some(KnxDataSecureConfig {
            is_secure_enabled: false,
            serial_number: None,
            fdsk: None,
            tool_key: None,
            sequence_number: 1,
        });
    }
    config.as_mut().unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fdsk_parse_and_tool_key_generation() {
        let hex_fdsk = "0123456789ABCDEF0123456789ABCDEF";
        let key1 = parse_fdsk(hex_fdsk).expect("Hex parse failed");
        assert_eq!(key1.len(), 16);

        let qr_fdsk = "01234-56789-ABCDE-FGHIJ-KLMNO-PQRST";
        let key2 = parse_fdsk(qr_fdsk).expect("QR parse failed");
        assert_eq!(key2.len(), 16);

        let tool_key = generate_tool_key();
        assert_eq!(tool_key.len(), 32);
        let decoded = hex::decode(&tool_key).unwrap();
        assert_eq!(decoded.len(), 16);
    }

    #[test]
    fn test_tp_data_secure_encrypt_decrypt_roundtrip() {
        let key = [0x2Bu8, 0x7E, 0x15, 0x16, 0x28, 0xAE, 0xD2, 0xA6, 0xAB, 0xF7, 0x15, 0x88, 0x09, 0xCF, 0x4F, 0x3C];
        let nonce = build_tp_data_secure_nonce(0x11FC, 42, 0x00);
        let aad = [0x11, 0x02, 0x00]; // e.g. Management APDU header
        let plaintext = b"KNX A_Memory_Write Payload";

        let (ciphertext, mac) = encrypt_tp_data_secure(&key, &nonce, &aad, plaintext);
        assert_ne!(&ciphertext[..], plaintext);
        assert_eq!(mac.len(), 4);

        let decrypted = decrypt_tp_data_secure(&key, &nonce, &aad, &ciphertext, &mac).expect("Decryption failed");
        assert_eq!(decrypted, plaintext);

        // Tamper test: Corrupt 1 byte in ciphertext
        let mut corrupted = ciphertext.clone();
        corrupted[0] ^= 0x01;
        let tamper_res = decrypt_tp_data_secure(&key, &nonce, &aad, &corrupted, &mac);
        assert!(tamper_res.is_err());
    }
}
