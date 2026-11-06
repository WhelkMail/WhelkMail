import { connect } from 'cloudflare:sockets'
import { toBase64 } from '../crypto'
import { bodyStructureHasAttachment, extractBodyStructure } from './bodystructure'

export type ImapSecurity = 'tls' | 'starttls'

export interface ImapConfig {
  host: string
  port: number
  security: ImapSecurity
}

export interface ImapFolder {
  name: string
  flags: string[]
}

export interface ImapHeader {
  uid: number
  flags: string[]
  size: number
  header: string
  hasAttachments: boolean
}

interface ImapPart {
  line: string
  literal?: Uint8Array
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class ImapError extends Error {}

class ImapTimeoutError extends ImapError {}

const COMMAND_TIMEOUT_MS = 20_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ImapTimeoutError(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function quote(value: string): string {
  const safe = value.replace(/[\r\n\0]/g, ' ')
  return `"${safe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function indexOfCrlf(buffer: Uint8Array): number {
  for (let i = 0; i + 1 < buffer.length; i += 1) {
    if (buffer[i] === 13 && buffer[i + 1] === 10) {
      return i
    }
  }
  return -1
}

export class ImapConnection {
  private socket: Socket
  private reader!: ReadableStreamDefaultReader<Uint8Array>
  private writer!: WritableStreamDefaultWriter<Uint8Array>
  private buffer = new Uint8Array(0)
  private tagCounter = 0

  private constructor(socket: Socket) {
    this.socket = socket
  }

  static async open(config: ImapConfig, timeoutMs = 20_000): Promise<ImapConnection> {
    const security = config.security === 'tls' ? 'on' : 'starttls'
    const socket = connect(
      { hostname: config.host, port: config.port },
      { secureTransport: security, allowHalfOpen: false },
    )
    const connection = new ImapConnection(socket)
    await withTimeout(socket.opened, timeoutMs, 'Connessione IMAP scaduta')
    connection.attach()
    let greeting: string
    try {
      greeting = await withTimeout(connection.readLine(), timeoutMs, 'Saluto IMAP scaduto')
    } catch (error) {
      connection.close()
      throw error
    }
    if (!greeting.toUpperCase().startsWith('* OK')) {
      connection.close()
      throw new ImapError(`Saluto IMAP inatteso: ${greeting}`)
    }
    if (config.security === 'starttls') {
      await connection.upgradeTls(timeoutMs)
    }
    return connection
  }

  private attach(): void {
    this.buffer = new Uint8Array(0)
    this.reader = this.socket.readable.getReader()
    this.writer = this.socket.writable.getWriter()
  }

  private async upgradeTls(timeoutMs: number): Promise<void> {
    const result = await this.command('STARTTLS')
    if (!result.ok) {
      throw new ImapError('STARTTLS rifiutato dal server IMAP')
    }
    try {
      this.reader.releaseLock()
    } catch {
      // ignore
    }
    try {
      this.writer.releaseLock()
    } catch {
      // ignore
    }
    const upgraded = this.socket.startTls()
    this.socket = upgraded
    await withTimeout(upgraded.opened, timeoutMs, 'Upgrade TLS IMAP scaduto')
    this.attach()
  }

  private async fill(): Promise<void> {
    const { value, done } = await this.reader.read()
    if (done || !value) {
      throw new ImapError('Connessione IMAP chiusa')
    }
    const merged = new Uint8Array(this.buffer.length + value.length)
    merged.set(this.buffer)
    merged.set(value, this.buffer.length)
    this.buffer = merged
  }

  private async readLine(): Promise<string> {
    while (true) {
      const index = indexOfCrlf(this.buffer)
      if (index >= 0) {
        const line = decoder.decode(this.buffer.subarray(0, index))
        this.buffer = this.buffer.subarray(index + 2)
        return line
      }
      await this.fill()
    }
  }

  private async readBytes(length: number): Promise<Uint8Array> {
    while (this.buffer.length < length) {
      await this.fill()
    }
    const bytes = this.buffer.slice(0, length)
    this.buffer = this.buffer.subarray(length)
    return bytes
  }

  private async writeLine(line: string): Promise<void> {
    await this.writer.write(encoder.encode(`${line}\r\n`))
  }

  private async command(
    command: string,
    onContinuation?: () => Promise<void>,
  ): Promise<{ parts: ImapPart[]; status: string; ok: boolean }> {
    try {
      return await withTimeout(
        this.executeCommand(command, onContinuation),
        COMMAND_TIMEOUT_MS,
        `Operazione IMAP scaduta: ${command.split(' ')[0]}`,
      )
    } catch (error) {
      if (error instanceof ImapTimeoutError) {
        this.close()
      }
      throw error
    }
  }

  private async executeCommand(
    command: string,
    onContinuation?: () => Promise<void>,
  ): Promise<{ parts: ImapPart[]; status: string; ok: boolean }> {
    const tag = `A${++this.tagCounter}`
    await this.writeLine(`${tag} ${command}`)
    const parts: ImapPart[] = []
    let status = ''
    while (true) {
      const line = await this.readLine()
      if (line.startsWith('+')) {
        if (onContinuation) {
          await onContinuation()
          continue
        }
        await this.writeLine('')
        continue
      }
      if (line.startsWith(`${tag} `)) {
        status = line
        break
      }
      const literal = line.match(/\{(\d+)\}$/)
      if (literal) {
        const bytes = await this.readBytes(Number(literal[1]))
        parts.push({ line, literal: bytes })
        await this.readLine()
        continue
      }
      parts.push({ line })
    }
    const ok = /^\S+ OK\b/i.test(status)
    if (!ok) {
      throw new ImapError(status)
    }
    return { parts, status, ok }
  }

  async login(username: string, password: string): Promise<void> {
    await this.command(`LOGIN ${quote(username)} ${quote(password)}`)
  }

  async authenticateXoauth2(username: string, accessToken: string): Promise<void> {
    const payload = `user=${username}\x01auth=Bearer ${accessToken}\x01\x01`
    const encoded = toBase64(encoder.encode(payload))
    await this.command('AUTHENTICATE XOAUTH2', async () => {
      await this.writeLine(encoded)
    })
  }

  async listFolders(): Promise<ImapFolder[]> {
    const { parts } = await this.command('LIST "" "*"')
    const folders: ImapFolder[] = []
    for (const part of parts) {
      const match = part.line.match(/^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$/)
      if (!match) {
        continue
      }
      const flags = match[1].split(/\s+/).filter(Boolean)
      let raw = match[2].trim()
      let name = raw
      if (raw.startsWith('"') && raw.endsWith('"')) {
        raw = raw.slice(1, -1)
        name = raw.replace(/\\(["\\])/g, '$1')
      }
      folders.push({ name, flags })
    }
    return folders
  }

  async select(folder: string): Promise<void> {
    await this.selectWithDetails(folder)
  }

  async selectWithDetails(folder: string): Promise<{
    uidValidity: number | null
    uidNext: number | null
    exists: number | null
  }> {
    const { parts } = await this.command(`SELECT ${quote(folder)}`)
    let uidValidity: number | null = null
    let uidNext: number | null = null
    let exists: number | null = null
    for (const part of parts) {
      const validity = part.line.match(/\[UIDVALIDITY (\d+)\]/i)
      if (validity) {
        uidValidity = Number(validity[1])
      }
      const next = part.line.match(/\[UIDNEXT (\d+)\]/i)
      if (next) {
        uidNext = Number(next[1])
      }
      const count = part.line.match(/^\* (\d+) EXISTS/)
      if (count) {
        exists = Number(count[1])
      }
    }
    return { uidValidity, uidNext, exists }
  }

  async searchAll(): Promise<number[]> {
    return this.searchUids('1:*')
  }

  async searchUids(range: string): Promise<number[]> {
    const { parts } = await this.command(`UID SEARCH UID ${range}`)
    const line = parts.map((part) => part.line).find((item) => item.startsWith('* SEARCH'))
    if (!line) {
      return []
    }
    return line
      .slice('* SEARCH'.length)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
      .filter((value) => Number.isFinite(value))
  }

  async searchRecentUids(limit: number, uidNext: number | null): Promise<number[]> {
    if (uidNext !== null && uidNext > 1) {
      const window = Math.max(limit * 4, 100)
      const start = Math.max(1, uidNext - window)
      const uids = await this.searchUids(`${start}:*`)
      return uids.slice(-limit)
    }
    return (await this.searchAll()).slice(-limit)
  }

  async firstUid(): Promise<number | null> {
    const { parts } = await this.command('UID FETCH 1 (UID)')
    for (const part of parts) {
      const match = part.line.match(/\bUID (\d+)/)
      if (match) {
        return Number(match[1])
      }
    }
    return null
  }

  async fetchUidsBySequence(start: number, end: number): Promise<number[]> {
    const { parts } = await this.command(`UID FETCH ${start}:${end} (UID)`)
    const uids: number[] = []
    for (const part of parts) {
      const match = part.line.match(/\bUID (\d+)/)
      if (match) {
        uids.push(Number(match[1]))
      }
    }
    return uids
  }

  async fetchFlags(uids: number[]): Promise<{ uid: number; flags: string[] }[]> {
    if (uids.length === 0) {
      return []
    }
    const { parts } = await this.command(`UID FETCH ${uids.join(',')} (UID FLAGS)`)
    const result: { uid: number; flags: string[] }[] = []
    for (const part of parts) {
      const uidMatch = part.line.match(/\bUID (\d+)/)
      if (!uidMatch) {
        continue
      }
      const flagsMatch = part.line.match(/\bFLAGS \(([^)]*)\)/)
      result.push({
        uid: Number(uidMatch[1]),
        flags: flagsMatch ? flagsMatch[1].split(/\s+/).filter(Boolean) : [],
      })
    }
    return result
  }

  async fetchHeaders(uids: number[]): Promise<ImapHeader[]> {
    if (uids.length === 0) {
      return []
    }
    const { parts } = await this.command(
      `UID FETCH ${uids.join(',')} (UID FLAGS RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])`,
    )
    const headers: ImapHeader[] = []
    for (const part of parts) {
      if (!part.literal) {
        continue
      }
      const uidMatch = part.line.match(/\bUID (\d+)/)
      if (!uidMatch) {
        continue
      }
      const flagsMatch = part.line.match(/\bFLAGS \(([^)]*)\)/)
      const sizeMatch = part.line.match(/\bRFC822\.SIZE (\d+)/)
      headers.push({
        uid: Number(uidMatch[1]),
        flags: flagsMatch ? flagsMatch[1].split(/\s+/).filter(Boolean) : [],
        size: sizeMatch ? Number(sizeMatch[1]) : part.literal.byteLength,
        header: decoder.decode(part.literal),
        hasAttachments: bodyStructureHasAttachment(extractBodyStructure(part.line)),
      })
    }
    return headers
  }

  async fetchFull(uid: number, markSeen = false): Promise<Uint8Array> {
    const { parts } = await this.command(`UID FETCH ${uid} (BODY${markSeen ? '' : '.PEEK'}[])`)
    const part = parts.find((item) => item.literal)
    if (!part?.literal) {
      throw new ImapError(`Messaggio ${uid} non trovato`)
    }
    return part.literal
  }

  async fetchFullMany(uids: number[]): Promise<Map<number, Uint8Array>> {
    const result = new Map<number, Uint8Array>()
    if (uids.length === 0) {
      return result
    }
    const { parts } = await this.command(
      `UID FETCH ${uids.join(',')} (UID BODY.PEEK[])`,
    )
    for (const part of parts) {
      if (!part.literal) {
        continue
      }
      const match = part.line.match(/\bUID (\d+)/)
      if (match) {
        result.set(Number(match[1]), part.literal)
      }
    }
    return result
  }

  async markSeen(uid: number): Promise<void> {
    await this.command(`UID STORE ${uid} +FLAGS (\\Seen)`)
  }

  async deleteMessage(uid: number): Promise<void> {
    await this.deleteMany([uid])
  }

  async deleteMany(uids: number[]): Promise<void> {
    if (uids.length === 0) {
      return
    }
    const set = uids.join(',')
    await this.command(`UID STORE ${set} +FLAGS (\\Deleted)`)
    try {
      await this.command(`UID EXPUNGE ${set}`)
    } catch {
      await this.command('EXPUNGE')
    }
  }

  async copy(uid: number, folder: string): Promise<void> {
    await this.copyMany([uid], folder)
  }

  async copyMany(uids: number[], folder: string): Promise<void> {
    if (uids.length === 0) {
      return
    }
    await this.command(`UID COPY ${uids.join(',')} ${quote(folder)}`)
  }

  async create(folder: string): Promise<void> {
    await this.command(`CREATE ${quote(folder)}`)
  }

  async append(
    folder: string,
    message: Uint8Array,
    flags = '(\\Seen)',
  ): Promise<{ uid: number | null }> {
    try {
      return await withTimeout(
        this.executeAppend(folder, message, flags),
        COMMAND_TIMEOUT_MS,
        'APPEND IMAP scaduto',
      )
    } catch (error) {
      if (error instanceof ImapTimeoutError) {
        this.close()
      }
      throw error
    }
  }

  private async executeAppend(
    folder: string,
    message: Uint8Array,
    flags: string,
  ): Promise<{ uid: number | null }> {
    const tag = `A${++this.tagCounter}`
    await this.writeLine(`${tag} APPEND ${quote(folder)} ${flags} {${message.length}}`)
    const continuation = await this.readLine()
    if (!continuation.startsWith('+')) {
      throw new ImapError(`APPEND rifiutato: ${continuation}`)
    }
    await this.writer.write(message)
    await this.writeLine('')
    while (true) {
      const line = await this.readLine()
      if (line.startsWith(`${tag} `)) {
        if (!/^\S+ OK\b/i.test(line)) {
          throw new ImapError(line)
        }
        const appendUid = line.match(/\[APPENDUID\s+\d+\s+(\d+)\]/i)
        return { uid: appendUid ? Number(appendUid[1]) : null }
      }
    }
  }

  async logout(): Promise<void> {
    try {
      await this.command('LOGOUT')
    } catch {
      // ignore
    }
    this.close()
  }

  close(): void {
    try {
      this.reader.releaseLock()
    } catch {
      // ignore
    }
    try {
      this.writer.close()
    } catch {
      // ignore
    }
    try {
      this.socket.close()
    } catch {
      // ignore
    }
  }
}
