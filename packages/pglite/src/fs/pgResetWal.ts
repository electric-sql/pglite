import { existsSync } from 'fs'
import { mkdir, open, readdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'

const PG_CONTROL_FILE_SIZE = 8192
const PG_CONTROL_VERSION = 1700
const DB_SHUTDOWNED = 1
const XLOG_BLCKSZ = 8192
const MIN_WAL_SEG_SIZE = 1024 * 1024
const MAX_WAL_SEG_SIZE = 1024 * 1024 * 1024
const SIZE_OF_XLOG_LONG_PHD = 40
const SIZE_OF_XLOG_RECORD = 24
const SIZE_OF_CHECKPOINT = 88
const XLOG_PAGE_MAGIC = 0xd116
const XLP_LONG_HEADER = 0x0002
const XLOG_CHECKPOINT_SHUTDOWN = 0x00
const XLR_BLOCK_ID_DATA_SHORT = 255
const RM_XLOG_ID = 0

const OFF = {
  // PGlite 0.4.x ships PostgreSQL 17; these are ControlFileData offsets for
  // that layout.
  systemIdentifier: 0,
  pgControlVersion: 8,
  state: 16,
  time: 24,
  checkPoint: 32,
  checkPointCopy: 40,
  checkPointCopyRedo: 40,
  checkPointCopyThisTimeLineID: 48,
  checkPointCopyTime: 104,
  minRecoveryPoint: 136,
  minRecoveryPointTLI: 144,
  backupStartPoint: 152,
  backupEndPoint: 160,
  backupEndRequired: 168,
  walLevel: 172,
  walLogHints: 176,
  maxConnections: 180,
  maxWorkerProcesses: 184,
  maxWalSenders: 188,
  maxPreparedXacts: 192,
  maxLocksPerXact: 196,
  trackCommitTimestamp: 200,
  xlogBlcksz: 224,
  xlogSegSize: 228,
  crc: 288,
} as const

const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let crc = i
  for (let j = 0; j < 8; j++) {
    crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1
  }
  crcTable[i] = crc >>> 0
}

function crc32c(chunks: Uint8Array[]) {
  let crc = 0xffffffff
  for (const chunk of chunks) {
    for (const byte of chunk) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function readUInt64LE(buf: Buffer, offset: number) {
  return buf.readBigUInt64LE(offset)
}

function writeUInt64LE(buf: Buffer, value: bigint, offset: number) {
  buf.writeBigUInt64LE(value, offset)
}

function parseWalSegNo(fileName: string, walSegSize: number) {
  if (!/^[0-9A-F]{24}$/.test(fileName)) return null
  const log = BigInt(`0x${fileName.slice(8, 16)}`)
  const seg = BigInt(`0x${fileName.slice(16, 24)}`)
  return log * (0x100000000n / BigInt(walSegSize)) + seg
}

function xlogFileName(tli: number, segNo: bigint, walSegSize: number) {
  const segmentsPerXlogId = 0x100000000n / BigInt(walSegSize)
  const log = segNo / segmentsPerXlogId
  const seg = segNo % segmentsPerXlogId
  return [
    tli.toString(16).toUpperCase().padStart(8, '0'),
    log.toString(16).toUpperCase().padStart(8, '0'),
    seg.toString(16).toUpperCase().padStart(8, '0'),
  ].join('')
}

async function unlinkIfExists(path: string) {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

async function writeFileSynced(path: string, data: Buffer) {
  const file = await open(path, 'w')
  try {
    await file.writeFile(data)
    await file.sync()
  } finally {
    await file.close()
  }
}

export async function resetWal(rootDir: string) {
  await unlinkIfExists(join(rootDir, 'postmaster.pid'))

  const pgVersion = (await readFile(join(rootDir, 'PG_VERSION'), 'utf8')).trim()
  if (pgVersion !== '17') {
    throw new Error(`Cannot reset WAL for unsupported PG_VERSION ${pgVersion}`)
  }

  const controlPath = join(rootDir, 'global', 'pg_control')
  const control = Buffer.from(await readFile(controlPath))
  if (control.length !== PG_CONTROL_FILE_SIZE) {
    throw new Error(`Unexpected pg_control size ${control.length}`)
  }
  if (control.readUInt32LE(OFF.pgControlVersion) !== PG_CONTROL_VERSION) {
    throw new Error('Unsupported pg_control version')
  }

  const walSegSize = control.readUInt32LE(OFF.xlogSegSize)
  const xlogBlcksz = control.readUInt32LE(OFF.xlogBlcksz)
  if (
    walSegSize < MIN_WAL_SEG_SIZE ||
    walSegSize > MAX_WAL_SEG_SIZE ||
    (walSegSize & (walSegSize - 1)) !== 0 ||
    0x100000000 % walSegSize !== 0
  ) {
    throw new Error(`Unsupported WAL segment size ${walSegSize}`)
  }
  if (xlogBlcksz !== XLOG_BLCKSZ) {
    throw new Error(`Unsupported WAL block size ${xlogBlcksz}`)
  }

  const tli = control.readUInt32LE(OFF.checkPointCopyThisTimeLineID)
  let newSegNo =
    readUInt64LE(control, OFF.checkPointCopyRedo) / BigInt(walSegSize)
  const walDir = join(rootDir, 'pg_wal')
  await mkdir(join(walDir, 'archive_status'), { recursive: true })
  for (const file of await readdir(walDir)) {
    const segNo = parseWalSegNo(file, walSegSize)
    if (segNo !== null && segNo > newSegNo) {
      newSegNo = segNo
    }
  }
  newSegNo += 1n

  const redo = newSegNo * BigInt(walSegSize) + BigInt(SIZE_OF_XLOG_LONG_PHD)
  const now = BigInt(Math.floor(Date.now() / 1000))

  writeUInt64LE(control, redo, OFF.checkPointCopyRedo)
  writeUInt64LE(control, now, OFF.checkPointCopyTime)
  control.writeInt32LE(DB_SHUTDOWNED, OFF.state)
  writeUInt64LE(control, now, OFF.time)
  writeUInt64LE(control, redo, OFF.checkPoint)
  writeUInt64LE(control, 0n, OFF.minRecoveryPoint)
  control.writeUInt32LE(0, OFF.minRecoveryPointTLI)
  writeUInt64LE(control, 0n, OFF.backupStartPoint)
  writeUInt64LE(control, 0n, OFF.backupEndPoint)
  control.writeUInt8(0, OFF.backupEndRequired)
  control.writeInt32LE(0, OFF.walLevel)
  control.writeUInt8(0, OFF.walLogHints)
  control.writeInt32LE(100, OFF.maxConnections)
  control.writeInt32LE(8, OFF.maxWorkerProcesses)
  control.writeInt32LE(10, OFF.maxWalSenders)
  control.writeInt32LE(0, OFF.maxPreparedXacts)
  control.writeInt32LE(64, OFF.maxLocksPerXact)
  control.writeUInt8(0, OFF.trackCommitTimestamp)
  control.writeUInt32LE(crc32c([control.subarray(0, OFF.crc)]), OFF.crc)

  for (const file of await readdir(walDir)) {
    if (/^[0-9A-F]{24}(?:\.partial)?$/.test(file)) {
      await unlink(join(walDir, file))
    }
  }

  const archiveStatusDir = join(walDir, 'archive_status')
  if (existsSync(archiveStatusDir)) {
    for (const file of await readdir(archiveStatusDir)) {
      if (/^[0-9A-F]{24}(?:\.partial)?\.(?:ready|done)$/.test(file)) {
        await unlink(join(archiveStatusDir, file))
      }
    }
  }
  const walSummaryDir = join(walDir, 'summaries')
  if (existsSync(walSummaryDir)) {
    for (const file of await readdir(walSummaryDir)) {
      if (/^[0-9A-F]{40}\.summary$/.test(file)) {
        await unlink(join(walSummaryDir, file))
      }
    }
  }

  const wal = Buffer.alloc(walSegSize)
  wal.writeUInt16LE(XLOG_PAGE_MAGIC, 0)
  wal.writeUInt16LE(XLP_LONG_HEADER, 2)
  wal.writeUInt32LE(tli, 4)
  writeUInt64LE(wal, redo - BigInt(SIZE_OF_XLOG_LONG_PHD), 8)
  wal.writeUInt32LE(0, 16)
  writeUInt64LE(wal, readUInt64LE(control, OFF.systemIdentifier), 24)
  wal.writeUInt32LE(walSegSize, 32)
  wal.writeUInt32LE(XLOG_BLCKSZ, 36)

  const recordOffset = SIZE_OF_XLOG_LONG_PHD
  const recordTotalLength = SIZE_OF_XLOG_RECORD + 2 + SIZE_OF_CHECKPOINT
  wal.writeUInt32LE(recordTotalLength, recordOffset)
  wal.writeUInt32LE(0, recordOffset + 4)
  writeUInt64LE(wal, 0n, recordOffset + 8)
  wal.writeUInt8(XLOG_CHECKPOINT_SHUTDOWN, recordOffset + 16)
  wal.writeUInt8(RM_XLOG_ID, recordOffset + 17)
  wal.writeUInt16LE(0, recordOffset + 18)
  wal.writeUInt8(XLR_BLOCK_ID_DATA_SHORT, recordOffset + SIZE_OF_XLOG_RECORD)
  wal.writeUInt8(SIZE_OF_CHECKPOINT, recordOffset + SIZE_OF_XLOG_RECORD + 1)
  control.copy(
    wal,
    recordOffset + SIZE_OF_XLOG_RECORD + 2,
    OFF.checkPointCopy,
    OFF.checkPointCopy + SIZE_OF_CHECKPOINT,
  )

  const record = wal.subarray(recordOffset, recordOffset + recordTotalLength)
  const recordCrc = crc32c([
    record.subarray(SIZE_OF_XLOG_RECORD),
    record.subarray(0, 20),
  ])
  wal.writeUInt32LE(recordCrc, recordOffset + 20)

  await writeFileSynced(
    join(walDir, xlogFileName(tli, newSegNo, walSegSize)),
    wal,
  )
  await writeFileSynced(controlPath, control)
}
