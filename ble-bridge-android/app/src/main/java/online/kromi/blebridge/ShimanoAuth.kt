package online.kromi.blebridge

import android.util.Log
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/**
 * Shimano STEPS EP800 / Di2 Authentication
 * Reverse-engineered from E-Tube Project APK.
 *
 * Uses Xorshift128 PRNG seeded with device + product serial numbers
 * to generate auth/common/encrypt/update keys.
 *
 * Generic — works with any Shimano STEPS drive unit (EP800, EP600, etc.)
 * as long as the BLE protocol uses service 000018FF-SHIMANO_BLE.
 */
object ShimanoAuth {
    private const val TAG = "ShimanoAuth"

    // Xorshift128 state
    private var x: Int = 0
    private var y: Int = 0
    private var z: Int = 0
    private var w: Int = 0
    private var w1: Byte = 0
    private var w2: Byte = 0
    private var w3: Byte = 0

    // Xorshift128 constants (from E-Tube APK)
    private const val X_INIT = 123456789
    private const val Y_INIT = 362436069
    private const val Z_INIT = 521288629
    private const val W_INIT = 88675123

    // Generated keys (16 bytes each)
    var authKey = ByteArray(16)
        private set
    var commonKey = ByteArray(16)
        private set
    var encryptKey = ByteArray(16)
        private set
    var updateKey = ByteArray(16)
        private set

    /** Core Xorshift128 step — returns next pseudo-random UInt */
    private fun execXorshift(): Int {
        val t = x xor (x shl 11)
        x = y
        y = z
        z = w
        w = (t xor (t ushr 8)) xor (w xor (w ushr 19))
        return w
    }

    /** Initialize PRNG with 4 seeds + warmup rounds */
    private fun initXorshift(xSeed: Int, ySeed: Int, zSeed: Int, wSeed: Int, warmup: Int) {
        x = xSeed xor X_INIT
        y = ySeed xor Y_INIT
        z = zSeed xor Z_INIT
        w = wSeed xor W_INIT

        // Warmup: run xorshift 'warmup' times, extracting w1/w2/w3 on first round
        for (i in 0 until warmup) {
            execXorshift()
            if (i == 0) {
                w1 = (w and 0xFF).toByte()
                w2 = ((w ushr 8) and 0xFF).toByte()
                w3 = ((w ushr 16) and 0xFF).toByte()
            }
        }
    }

    private fun reset() {
        x = 0; y = 0; z = 0; w = 0
        w1 = 0; w2 = 0; w3 = 0
    }

    /** Fill a 16-byte key using xorshift, 4 bytes per xorshift call */
    private fun fillKey(key: ByteArray, size: Int = 16) {
        var rnd = 0
        for (i in 0 until size) {
            val mod = i % 4
            if (mod == 0) rnd = execXorshift()
            key[i] = ((rnd ushr (mod * 8)) and 0xFF).toByte()
        }
    }

    /** Skip N xorshift rounds (consume PRNG state) */
    private fun skipRounds(count: Int) {
        for (i in 0 until count) execXorshift()
    }

    /**
     * Result of key generation — allows thread-safe usage without reading singleton state.
     */
    data class AuthKeys(
        val authKey: ByteArray,
        val encKey: ByteArray,
        val decKey: ByteArray,
        val commonKey: ByteArray,
        val updateKey: ByteArray,
    )

    /**
     * Generate all 4 keys from device + product serial numbers.
     *
     * Thread-safe: core computation uses local state, then updates singleton fields.
     *
     * @param dcasSerialHex The DCAS wireless unit serial as hex string
     *                      (typically derived from BLE address or 2AE2 data)
     * @param productSerial The product serial string (e.g., "3KAXEAAF7C1")
     * @return AuthKeys with all generated keys, or null if dcasSerialHex is invalid
     */
    fun generateKeys(dcasSerialHex: String, productSerial: String): AuthKeys? {
        // Validate input
        val dSerial = try {
            dcasSerialHex.toLong(16)
        } catch (e: NumberFormatException) {
            Log.e(TAG, "Invalid DCAS serial hex: $dcasSerialHex", e)
            return null
        }

        reset()

        // Take last 6 chars of product serial as ASCII bytes
        val pSuffix = productSerial.takeLast(6)
        val pBytes = pSuffix.toByteArray(Charsets.US_ASCII)

        // Build 6 UShorts: each = (productByte << 8) | deviceByte
        val shorts = IntArray(6)
        for (i in 0 until 6) {
            val pByte = if (i < pBytes.size) (pBytes[i].toInt() and 0xFF) else 0
            val dByte = ((dSerial shr (i * 8)) and 0xFF).toInt()
            shorts[i] = (pByte shl 8) or dByte
        }

        // Build 4 x 32-bit seeds from the 6 shorts
        val seedX = (shorts[0] shl 16) or shorts[1]
        val seedY = (shorts[2] shl 16) or shorts[3]
        val seedZ = (shorts[4] shl 16) or shorts[5]
        val seedW = (shorts[5] shl 16) or shorts[0]

        // Warmup rounds = high byte of shorts[5]
        val warmup = (shorts[5] ushr 8) and 0xFF

        initXorshift(seedX, seedY, seedZ, seedW, warmup)

        // 1. Generate authKey: first 7 bytes from PRNG, bytes 7-15 = 0xFF
        authKey = ByteArray(16) { 0xFF.toByte() }
        var rnd = 0
        for (i in 0 until 7) {
            val mod = i % 4
            if (mod == 0) rnd = execXorshift()
            authKey[i] = ((rnd ushr (mod * 8)) and 0xFF).toByte()
        }

        // 2. Skip w1 rounds → generate commonKey
        skipRounds(w1.toInt() and 0xFF)
        commonKey = ByteArray(16)
        fillKey(commonKey)

        // 3. Skip w2 rounds → generate encryptKey
        skipRounds(w2.toInt() and 0xFF)
        encryptKey = ByteArray(16)
        fillKey(encryptKey)

        // 4. Skip w3 rounds → generate updateKey
        skipRounds(w3.toInt() and 0xFF)
        updateKey = ByteArray(16)
        fillKey(updateKey)

        Log.d(TAG, "Keys generated successfully")

        return AuthKeys(
            authKey = authKey.copyOf(),
            encKey = encryptKey.copyOf(),
            decKey = encryptKey.copyOf(),
            commonKey = commonKey.copyOf(),
            updateKey = updateKey.copyOf(),
        )
    }

    /**
     * Encrypt authKey with encryptKey using AES-128-ECB (no padding).
     * This is the value sent to AUTH_CONTROL (2AF3) for authentication.
     */
    fun getAuthPayload(): ByteArray {
        return try {
            val cipher = Cipher.getInstance("AES/ECB/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(encryptKey, "AES"))
            cipher.doFinal(authKey)
        } catch (e: Exception) {
            Log.e(TAG, "AES encrypt failed: ${e.message}")
            ByteArray(16)
        }
    }

    /**
     * Encrypt arbitrary data with the encryptKey (for PCE commands).
     */
    fun encrypt(data: ByteArray): ByteArray {
        return try {
            val cipher = Cipher.getInstance("AES/ECB/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(encryptKey, "AES"))
            // Pad to 16-byte boundary
            val padded = if (data.size % 16 != 0) {
                data.copyOf((data.size / 16 + 1) * 16)
            } else data
            cipher.doFinal(padded)
        } catch (e: Exception) {
            Log.e(TAG, "Encrypt failed: ${e.message}")
            data
        }
    }

    /**
     * Decrypt data received from PCE_RESPONSE.
     */
    fun decrypt(data: ByteArray): ByteArray {
        return try {
            val cipher = Cipher.getInstance("AES/ECB/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(encryptKey, "AES"))
            cipher.doFinal(data)
        } catch (e: Exception) {
            Log.e(TAG, "Decrypt failed: ${e.message}")
            data
        }
    }
}
