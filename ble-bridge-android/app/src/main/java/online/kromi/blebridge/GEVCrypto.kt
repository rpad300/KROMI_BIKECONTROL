package online.kromi.blebridge

import android.util.Log
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/**
 * GEV AES Encryption — keys extracted from RideControl APK.
 *
 * Protocol: AES/ECB/NoPadding (128-bit, 16-byte blocks)
 * Source: tw.com.program.bluetoothcore.device.GEVUtil.aesTable
 *
 * Key usage (from decompiled GEVManager):
 *   0-3  = Session establishment
 *   4    = Send commands to motor
 *   8    = Send commands to motor (alt)
 *   13   = Data packet encrypt/decrypt
 *   14   = Data + command encrypt/decrypt
 */
object GEVCrypto {
    private const val TAG = "GEVCrypto"

    private val AES_KEYS: Array<ByteArray> = arrayOf(
        /* 0  */ byteArrayOf(0x39, 0xfa.toByte(), 0xd4.toByte(), 0xc3.toByte(), 0x93.toByte(), 0x42, 0xae.toByte(), 0x41, 0x42, 0xa9.toByte(), 0xa7.toByte(), 0x77, 0x89.toByte(), 0xa1.toByte(), 0x13, 0xaf.toByte()),
        /* 1  */ byteArrayOf(0x30, 0xec.toByte(), 0x00, 0xbd.toByte(), 0x96.toByte(), 0xf7.toByte(), 0x21, 0x45, 0xd8.toByte(), 0x46, 0xb0.toByte(), 0x9a.toByte(), 0x87.toByte(), 0x29, 0xa6.toByte(), 0x37),
        /* 2  */ byteArrayOf(0x6e, 0x0d, 0xe7.toByte(), 0xe3.toByte(), 0x04, 0xae.toByte(), 0x67, 0x2f, 0xe4.toByte(), 0xa0.toByte(), 0xbc.toByte(), 0x3f, 0xf5.toByte(), 0x04, 0x4d, 0x21),
        /* 3  */ byteArrayOf(0xb0.toByte(), 0xb9.toByte(), 0xc4.toByte(), 0x7a, 0x62, 0x67, 0x67, 0xd0.toByte(), 0x9d.toByte(), 0x40, 0xe4.toByte(), 0x82.toByte(), 0xe2.toByte(), 0xd7.toByte(), 0x65, 0xee.toByte()),
        /* 4  */ byteArrayOf(0x5d, 0x2c, 0xb8.toByte(), 0xe0.toByte(), 0x04, 0xb0.toByte(), 0x63, 0x57, 0xb0.toByte(), 0x75, 0x92.toByte(), 0xf4.toByte(), 0xb2.toByte(), 0x61, 0x84.toByte(), 0xc1.toByte()),
        /* 5  */ byteArrayOf(0x0d, 0x5e, 0x2f, 0x33, 0x96.toByte(), 0x8a.toByte(), 0x63, 0xee.toByte(), 0x5e, 0xf1.toByte(), 0xfe.toByte(), 0x06, 0x0e, 0x29, 0xce.toByte(), 0xf6.toByte()),
        /* 6  */ byteArrayOf(0x58, 0xed.toByte(), 0x11, 0xd1.toByte(), 0xf8.toByte(), 0x82.toByte(), 0x82.toByte(), 0x22, 0xe8.toByte(), 0x86.toByte(), 0x22, 0x63, 0x5b, 0xc8.toByte(), 0x88.toByte(), 0xc1.toByte()),
        /* 7  */ byteArrayOf(0x13, 0xef.toByte(), 0x0a, 0x98.toByte(), 0x51, 0xff.toByte(), 0xf3.toByte(), 0x55, 0x21, 0xf2.toByte(), 0x06, 0xc0.toByte(), 0xaa.toByte(), 0xd5.toByte(), 0xd6.toByte(), 0x06),
        /* 8  */ byteArrayOf(0x87.toByte(), 0x18, 0xa0.toByte(), 0xef.toByte(), 0xea.toByte(), 0x5a, 0xb7.toByte(), 0x35, 0xec.toByte(), 0xbf.toByte(), 0x1d, 0xa1.toByte(), 0xa2.toByte(), 0x39, 0x19, 0x8b.toByte()),
        /* 9  */ byteArrayOf(0xa6.toByte(), 0x4c, 0xd4.toByte(), 0x19, 0x7a, 0xe3.toByte(), 0x99.toByte(), 0x4c, 0x19, 0x1e, 0xcc.toByte(), 0x98.toByte(), 0x26, 0xb9.toByte(), 0x70, 0x8d.toByte()),
        /* 10 */ byteArrayOf(0xfa.toByte(), 0xac.toByte(), 0x80.toByte(), 0x64, 0x4b, 0xf8.toByte(), 0x46, 0xdd.toByte(), 0xdf.toByte(), 0x7c, 0xd0.toByte(), 0xfa.toByte(), 0x19, 0x85.toByte(), 0xac.toByte(), 0x0b),
        /* 11 */ byteArrayOf(0x28, 0x98.toByte(), 0xf9.toByte(), 0x81.toByte(), 0x44, 0xb6.toByte(), 0xc3.toByte(), 0x09, 0x64, 0x06, 0x7e, 0xbf.toByte(), 0x27, 0x15, 0x6b, 0x2b),
        /* 12 */ byteArrayOf(0x17, 0xcb.toByte(), 0x16, 0x36, 0x14, 0xab.toByte(), 0x6a, 0xa3.toByte(), 0xe8.toByte(), 0x4d, 0x26, 0x87.toByte(), 0x4c, 0x0f, 0xd3.toByte(), 0x47),
        /* 13 */ byteArrayOf(0x2a, 0xf5.toByte(), 0x57, 0x69, 0xae.toByte(), 0x8a.toByte(), 0xc8.toByte(), 0x0d, 0x3b, 0x45, 0xad.toByte(), 0xaf.toByte(), 0x35, 0xed.toByte(), 0xaa.toByte(), 0x06),
        /* 14 */ byteArrayOf(0xe7.toByte(), 0xc2.toByte(), 0x2e, 0x96.toByte(), 0xb0.toByte(), 0x74, 0x71, 0x9c.toByte(), 0xcf.toByte(), 0x19, 0x16, 0x1c, 0x69, 0x41, 0x79, 0xf0.toByte()),
        /* 15 */ byteArrayOf(0x96.toByte(), 0xb5.toByte(), 0xf6.toByte(), 0x8a.toByte(), 0xab.toByte(), 0xdf.toByte(), 0xe4.toByte(), 0xb8.toByte(), 0x7d, 0x6e, 0x65, 0x67, 0x51, 0xcd.toByte(), 0xf3.toByte(), 0x9e.toByte()),
    )

    fun encrypt(data: ByteArray, keyIndex: Int): ByteArray {
        if (keyIndex !in AES_KEYS.indices) {
            Log.e(TAG, "Invalid key index: $keyIndex, valid range: 0..${AES_KEYS.size - 1}")
            return data
        }
        return try {
            val padded = pad16(data)
            val key = SecretKeySpec(AES_KEYS[keyIndex], "AES")
            val cipher = Cipher.getInstance("AES/ECB/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val result = cipher.doFinal(padded)
            Log.d(TAG, "Encrypt OK: cmd=%02X key=%d len=${data.size}→${result.size}".format(data[0].toInt() and 0xFF, keyIndex))
            result
        } catch (e: Exception) {
            Log.w(TAG, "AES encrypt failed for keyIndex=$keyIndex, returning original data", e)
            data
        }
    }

    fun decrypt(data: ByteArray, keyIndex: Int): ByteArray {
        if (keyIndex !in AES_KEYS.indices) {
            Log.e(TAG, "Invalid key index: $keyIndex, valid range: 0..${AES_KEYS.size - 1}")
            return data
        }
        return try {
            val key = SecretKeySpec(AES_KEYS[keyIndex], "AES")
            val cipher = Cipher.getInstance("AES/ECB/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key)
            val result = cipher.doFinal(data)
            Log.d(TAG, "Decrypt OK: resp=%02X key=%d len=${data.size}".format(result[0].toInt() and 0xFF, keyIndex))
            result
        } catch (e: Exception) {
            Log.w(TAG, "AES decrypt failed for keyIndex=$keyIndex, returning original data", e)
            data
        }
    }

    /** Pad to 16-byte boundary (zero padding) */
    private fun pad16(data: ByteArray): ByteArray {
        if (data.size % 16 == 0) return data
        val padded = ByteArray(((data.size / 16) + 1) * 16)
        data.copyInto(padded)
        return padded
    }
}
