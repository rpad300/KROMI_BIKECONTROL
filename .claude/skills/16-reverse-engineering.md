# 16 — Reverse Engineering & Protocol Discovery

> **Skill type:** Claude Code Skill
> **Role:** Reverse Engineering Specialist — decompila APKs, analisa protocolos BLE, extrai comandos/telemetria, documenta e implementa em TypeScript.
> **Stack:** JADX + nRF Connect + Web Bluetooth + KROMI protocol services

---

## Role Definition

Tu es o especialista de reverse engineering do KROMI BikeControl. O teu trabalho e decompor APKs de fabricantes de eBikes e acessorios, descobrir protocolos BLE proprietarios, documentar cada byte, e transformar isso em servicos TypeScript funcionais na PWA.

**Resultado comprovado:** 8 APKs decompilados, 7 protocolos BLE completos implementados e a funcionar em producao.

---

## APKs Ja Decompilados (Referencia)

| App | APK | Source Dir | Protocolo Extraido |
|-----|-----|------------|-------------------|
| Giant RideControl | RideControl.apk | `APKRIDECONTROL/ridecontrol_src/` | GEV Motor (F0BA3012) |
| Shimano E-TUBE RIDE | E-TUBE RIDE.apk | `APKRIDECONTROL/etube_src/` | STEPS SBI (0x18EF) |
| Bosch eBike Connect | eBike Connect.apk | `APKRIDECONTROL/bosch_src/` | MCSP+STP+protobuf |
| Specialized Flow | Flow.apk | `APKRIDECONTROL/flow_src/` | TurboConnect (3-service) |
| Garmin Connect | Garmin Connect.apk | `APKRIDECONTROL/garmin_src/` | Varia GFDI (6A4E/16AA) |
| iGPSPORT Ride | iGPSPORT Ride.apk | `APKRIDECONTROL/igpsport_src/` | NUS CA8E + protobuf |
| SRAM AXS | — | — | Flight Attendant (4D5000) |
| Avinox Ride | Avinox Ride.apk | `APKRIDECONTROL/avinox_src/` | Em analise |

---

## Workflow Completo de Reverse Engineering

### Fase 1 — Obter e Decompilar APK

```bash
# 1. Obter APK (Google Play via APKMirror/APKPure, ou extrair do telemovel)
adb pull /data/app/com.giant.ridecontrol/base.apk RideControl.apk

# 2. Decompilar com JADX (Java/Kotlin source)
# JADX config: APKRIDECONTROL/PowerShell 7.6.0/skylot/jadx/
export JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.10.7-hotspot"
jadx -d ridecontrol_src/ RideControl.apk

# 3. Alternativa: apktool para resources/smali
apktool d RideControl.apk -o ridecontrol_extract/
```

**IMPORTANTE:** Os APKs e source decompilado ficam SEMPRE em `APKRIDECONTROL/`. NUNCA commitar APKs no git (`.gitignore` ja bloqueia).

### Fase 2 — Identificar Servicos BLE

Procurar UUIDs de servicos e caracteristicas no source decompilado:

```bash
# Procurar UUIDs BLE padrao (16-bit)
grep -rn "0x180[0-9A-Fa-f]" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt"

# Procurar UUIDs completos (128-bit)
grep -rn "[0-9a-fA-F]\{8\}-[0-9a-fA-F]\{4\}-" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt"

# Procurar constantes de servico BLE
grep -rn "BluetoothGattService\|SERVICE_UUID\|CHARACTERISTIC" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt"

# Procurar classes de protocolo (nomes comuns)
grep -rn "BleManager\|GattCallback\|onCharacteristic\|writeCharacteristic" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt" -l
```

### Fase 3 — Tracar Command Builders

Uma vez identificados os servicos, tracar como os comandos sao construidos:

```bash
# Procurar funcoes que constroem pacotes
grep -rn "ByteArray\|byteArrayOf\|byte\[\]\|ByteBuffer\|writeByte" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt" -l

# Procurar checksum/CRC
grep -rn "checksum\|xor\|crc\|0xFF\|0xFB\|0xFC" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt"

# Procurar encriptacao
grep -rn "AES\|Cipher\|encrypt\|decrypt\|SecretKey\|IV\|ECB\|CBC" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt"

# Procurar enums de modos/comandos
grep -rn "enum\|ECO\|TRAIL\|SPORT\|TURBO\|BOOST\|POWER\|OFF" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt"
```

### Fase 4 — Extrair Telemetria Parsers

```bash
# Procurar como dados de notificacao sao parseados
grep -rn "onCharacteristicChanged\|onNotification\|parseValue\|getValue" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt" -l

# Procurar byte offsets e bit manipulation
grep -rn "getInt\|getShort\|shl\|shr\|and 0x\|ushr\|toInt()" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt"

# Procurar protobuf (Bosch, iGPSPORT)
grep -rn "protobuf\|GeneratedMessageLite\|parseFrom\|toByteArray\|writeTo" APKRIDECONTROL/ridecontrol_src/ --include="*.java" --include="*.kt" -l
```

### Fase 5 — Validar com nRF Connect

Apos extrair o protocolo do source, validar com captura BLE real:

```bash
# Documentacao de captura: docs/NRF_CAPTURE_ANALYSIS.md
# nRF Connect app no telemovel para capturar pacotes
# Comparar bytes capturados com o que o source decompilado mostra
```

**Checklist de validacao:**
- [ ] UUID do servico e caracteristica confirmados
- [ ] Byte order confirmado (little-endian vs big-endian)
- [ ] Checksum verificado (XOR, sum, CRC)
- [ ] Encriptacao identificada (plaintext, AES-ECB, AES-CBC, protobuf)
- [ ] Telemetria: refresh rate medido (~1s plaintext, ~5s encrypted)
- [ ] Comandos: resposta do dispositivo validada

### Fase 6 — Documentar Protocolo

Criar documentacao em `docs/` com formato padrao:

```markdown
# [MARCA] [DISPOSITIVO] BLE Protocol

## Service UUIDs
| Service | UUID | Type |
|---------|------|------|
| Motor Control | XXXXXXXX-... | Primary |
| Telemetry | XXXXXXXX-... | Primary |

## Characteristics
| Characteristic | UUID | Properties | Description |
|----------------|------|------------|-------------|
| Command Write | XXXX | WRITE | Send commands to device |
| Telemetry Notify | XXXX | NOTIFY | Receive telemetry data |

## Packet Format
| Offset | Size | Field | Values |
|--------|------|-------|--------|
| 0 | 1 | Header | 0xFC |
| 1 | 1 | Device ID | 0x21=motor, 0x22=battery |
| 2 | 1 | Command | see table |
| ... | ... | ... | ... |
| N | 1 | Checksum | XOR of bytes 0..N-1 |

## Commands
| ID | Name | Payload | Response |
|----|------|---------|----------|
| 0x01 | Set Mode | 1 byte (mode enum) | ACK |

## Telemetry Fields
| Byte | Field | Unit | Formula |
|------|-------|------|---------|
| 0-1 | Speed | km/h | uint16_LE / 10 |
| 2-3 | Cadence | RPM | uint16_LE |

## Encryption
[AES-128-ECB / plaintext / protobuf details]

## Mode Enum
| Value | Mode |
|-------|------|
| 0 | OFF |
| 1 | ECO |
```

### Fase 7 — Implementar em TypeScript

Criar servico em `src/services/protocols/` ou `src/services/accessories/`:

```typescript
// src/services/protocols/[Brand]Service.ts

const SERVICE_UUID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
const COMMAND_CHAR = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
const TELEMETRY_CHAR = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

interface [Brand]Telemetry {
  speed: number;        // km/h
  cadence: number;      // RPM
  power: number;        // watts
  battery: number;      // 0-100%
  mode: AssistMode;
}

// Comando builder
function buildCommand(cmd: number, payload: Uint8Array): Uint8Array {
  const packet = new Uint8Array(payload.length + 3);
  packet[0] = 0xFC;  // header
  packet[1] = cmd;
  packet.set(payload, 2);
  packet[packet.length - 1] = xorChecksum(packet, 0, packet.length - 1);
  return packet;
}

// Telemetria parser
function parseTelemetry(data: DataView): [Brand]Telemetry {
  return {
    speed: data.getUint16(0, true) / 10,   // LE
    cadence: data.getUint16(2, true),
    power: data.getInt16(4, true),
    battery: data.getUint8(6),
    mode: data.getUint8(7) as AssistMode,
  };
}
```

**Regras de implementacao:**
- SEMPRE registar o novo servico em `GiantBLEService` (ou criar novo service manager)
- NUNCA usar `navigator.bluetooth` directamente em componentes
- Adicionar modo de simulacao para desenvolvimento sem dispositivo
- Adicionar ao `bikeStore` ou store relevante
- Documentar UUIDs na tabela BLE Services do CLAUDE.md

---

## Protocolo de Analise de Codigo Obfuscado

O source JADX vem tipicamente obfuscado (a/, a0/, b/, etc.). Estrategias:

```bash
# 1. Comecar pelas strings — nao sao obfuscadas
grep -rn "\"BLE\"\|\"bluetooth\"\|\"gatt\"\|\"service\"" APKRIDECONTROL/[app]_src/ --include="*.java"

# 2. Procurar imports de Android BLE (nao obfuscados)
grep -rn "android.bluetooth\|BluetoothGatt\|BluetoothAdapter" APKRIDECONTROL/[app]_src/ --include="*.java" -l

# 3. Procurar constantes numericas (UUIDs, headers, keys)
grep -rn "fromString\|UUID.fromString\|0x[0-9A-Fa-f]" APKRIDECONTROL/[app]_src/ --include="*.java"

# 4. Procurar arrays de bytes (chaves AES, payloads fixos)
grep -rn "new byte\[\]\|byteArrayOf\|{.*0x.*,.*0x.*}" APKRIDECONTROL/[app]_src/ --include="*.java" --include="*.kt"

# 5. Seguir call chain a partir do UUID
# UUID encontrado → classe que o usa → metodos de write/notify → payload builders
```

---

## Ferramentas Necessarias

| Ferramenta | Proposito | Instalacao |
|------------|-----------|------------|
| **JADX** | Decompilar APK → Java/Kotlin | `APKRIDECONTROL/skylot/jadx/` (ja instalado) |
| **apktool** | Extrair resources + smali | `pip install apktool` ou download |
| **nRF Connect** | Captura BLE ao vivo | Google Play (Android) |
| **adb** | Extrair APK do telemovel | Android SDK |
| **Java 21** | Runtime para JADX | `jdk-21.0.10.7-hotspot` (ja instalado) |
| **Wireshark + btatt** | Analise pcap BLE (opcional) | Desktop |
| **frida** | Hook runtime (avancado) | `pip install frida-tools` |

---

## Padroes Descobertos (Licoes Aprendidas)

### Checksum
- Giant GEV: **XOR** de todos os bytes (NAO sum)
- Shimano: **CRC-8** padrao
- Bosch: **protobuf** built-in validation

### Encriptacao
- Giant: **AES-128-ECB** com 16 chaves estaticas em `GEVCrypto.kt`
- Shimano: **plaintext** (autenticacao E-Tube separada)
- Bosch: **protobuf** payload dentro de segmentos STP de 20 bytes
- iGPSPORT: header 20 bytes + **protobuf** fields

### Byte Order
- Giant: **little-endian** para telemetria
- Shimano: **big-endian** para comandos STEPS
- Standard BLE (CSC, Power, HR): **little-endian** sempre

### Enderecos BLE
- Giant: **endereco publico** (connectavel directamente)
- iGPSPORT: **endereco privado rotativo** (requer scan-then-connect, NAO connectGatt directo)
- Garmin: **endereco publico** com bonding

### Refresh Rates
- Telemetria plaintext: **~1s**
- Telemetria encriptada: **~5s**
- Comandos: resposta em **<100ms**

---

## Checklist de Novo Protocolo

```
[ ] APK obtido e colocado em APKRIDECONTROL/
[ ] JADX decompilacao completa em [app]_src/
[ ] UUIDs de servico e caracteristica extraidos
[ ] Command builder tracado (header, payload, checksum)
[ ] Telemetria parser tracado (offsets, tipos, formulas)
[ ] Encriptacao identificada (plain/AES/protobuf)
[ ] Byte order confirmado
[ ] Enums de modos/comandos listados
[ ] Validado com nRF Connect (pacotes reais)
[ ] Documentado em docs/[MARCA]_PROTOCOL.md
[ ] Servico TypeScript implementado em src/services/
[ ] Registado em GiantBLEService ou service manager
[ ] Modo simulacao adicionado
[ ] CLAUDE.md BLE Services tabela actualizada
[ ] Memory reference criada
[ ] kromi-doc sync confirmado
```

---

## Anti-Patterns

| Anti-pattern | Correcto |
|---|---|
| Commitar APKs no git | APKs ficam APENAS em `APKRIDECONTROL/` (gitignored) |
| Assumir byte order sem confirmar | SEMPRE verificar com nRF capture |
| Assumir checksum = sum | Testar XOR, CRC-8, CRC-16, sum |
| Copiar protocolo de documentacao online | Validar SEMPRE com decompilacao — docs oficiais estao frequentemente incompletos |
| Usar `navigator.bluetooth` no componente | Registar no service manager, usar via store |
| Ignorar enderecos privados | iGPSPORT requer scan-then-connect |
| Hardcodar chaves AES | Colocar em config, placeholder no repo |
