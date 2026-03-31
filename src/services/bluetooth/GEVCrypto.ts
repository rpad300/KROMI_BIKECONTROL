/**
 * GEV AES Encryption/Decryption placeholder.
 *
 * The Giant Smart Gateway (GEV protocol) encrypts motor control
 * payloads with AES. The key must be extracted from the Giant
 * RideControl APK (GEVUtil.getAesKey in com.giant.ridecontrol).
 *
 * Until the key is obtained:
 * - READ operations work (battery, speed, cadence, power via standard BLE)
 * - WRITE operations (motor control) will likely fail or be ignored
 *
 * When the key is obtained, set it in GEV_AES_KEY and the
 * encrypt/decrypt functions will be used automatically.
 */

// TODO: Replace with actual AES key extracted from APK
const GEV_AES_KEY: Uint8Array | null = null;

export function isEncryptionAvailable(): boolean {
  return GEV_AES_KEY !== null;
}

export async function encrypt(data: Uint8Array): Promise<Uint8Array> {
  if (!GEV_AES_KEY) {
    console.warn('[GEVCrypto] AES key not available, sending unencrypted');
    return data;
  }

  try {
    const key = await crypto.subtle.importKey('raw', GEV_AES_KEY, 'AES-ECB', false, ['encrypt']);
    // Pad to 16 bytes (AES block size)
    const padded = new Uint8Array(Math.ceil(data.length / 16) * 16);
    padded.set(data);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, padded);
    return new Uint8Array(encrypted);
  } catch (err) {
    console.error('[GEVCrypto] Encryption failed:', err);
    return data;
  }
}

export async function decrypt(data: Uint8Array): Promise<Uint8Array> {
  if (!GEV_AES_KEY) {
    return data; // Return raw data if no key
  }

  try {
    const key = await crypto.subtle.importKey('raw', GEV_AES_KEY, 'AES-ECB', false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, key, data);
    return new Uint8Array(decrypted);
  } catch (err) {
    console.error('[GEVCrypto] Decryption failed:', err);
    return data;
  }
}
