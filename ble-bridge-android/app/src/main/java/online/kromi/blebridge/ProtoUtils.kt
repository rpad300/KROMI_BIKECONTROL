package online.kromi.blebridge

/**
 * Shared protobuf encoding/decoding utilities.
 * Used by BoschBikeManager, SpecializedBikeManager, ShimanoMotorManager, AccessoryService.
 */
object ProtoUtils {

    fun encodeVarint(value: Int): ByteArray {
        val result = mutableListOf<Byte>()
        var v = value and 0x7FFFFFFF
        while (v > 0x7F) {
            result.add((v or 0x80).toByte())
            v = v ushr 7
        }
        result.add(v.toByte())
        return result.toByteArray()
    }

    fun encodeField(fieldNumber: Int, wireType: Int, value: Int): ByteArray {
        val tag = (fieldNumber shl 3) or wireType
        return encodeVarint(tag) + encodeVarint(value)
    }

    /** Convenience: encode a varint field (wireType=0) */
    fun encodeField(fieldNumber: Int, value: Int): ByteArray {
        return encodeField(fieldNumber, 0, value)
    }

    fun parseProtoFields(data: ByteArray): Map<Int, Int> {
        val fields = mutableMapOf<Int, Int>()
        var offset = 0
        while (offset < data.size) {
            // Parse tag
            var tag = 0
            var shift = 0
            var b: Int
            do {
                if (offset >= data.size) return fields
                b = data[offset++].toInt() and 0xFF
                tag = tag or ((b and 0x7F) shl shift)
                shift += 7
            } while (b and 0x80 != 0 && shift < 35)

            val fieldNumber = tag ushr 3
            val wireType = tag and 0x07

            when (wireType) {
                0 -> { // Varint
                    var value = 0
                    shift = 0
                    do {
                        if (offset >= data.size) return fields
                        b = data[offset++].toInt() and 0xFF
                        value = value or ((b and 0x7F) shl shift)
                        shift += 7
                    } while (b and 0x80 != 0 && shift < 35)
                    fields[fieldNumber] = value
                }
                2 -> { // Length-delimited
                    var length = 0
                    shift = 0
                    do {
                        if (offset >= data.size) return fields
                        b = data[offset++].toInt() and 0xFF
                        length = length or ((b and 0x7F) shl shift)
                        shift += 7
                    } while (b and 0x80 != 0)
                    if (offset + length > data.size) break  // bounds check
                    offset += length // skip length-delimited content
                }
                else -> break // Unknown wire type
            }
        }
        return fields
    }
}
