import type { AccountRow } from '../db'
import { decryptString, encryptString } from '../crypto'
import type { Env } from '../env'
import { createDriveFolder, refreshAccessToken } from '../drive/oauth'
import type { GetResult, PutResult, StorageAdapter } from './types'

interface DriveFile {
  id?: string
  size?: string
  error?: { message?: string }
}

export class DriveStorage implements StorageAdapter {
  driver = 'drive' as const
  private env: Env
  private row: AccountRow

  constructor(env: Env, row: AccountRow) {
    this.env = env
    this.row = row
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    if (
      this.row.drive_access_token_enc &&
      this.row.drive_token_expires_at &&
      this.row.drive_token_expires_at > now + 60
    ) {
      return decryptString(this.env, this.row.drive_access_token_enc)
    }
    if (!this.row.drive_refresh_token_enc) {
      throw new Error('Google Drive is not connected for this account')
    }
    const refreshToken = await decryptString(this.env, this.row.drive_refresh_token_enc)
    const token = await refreshAccessToken(this.env, refreshToken)
    const encrypted = await encryptString(this.env, token.access_token)
    const expiresAt = now + token.expires_in
    await this.env.DB.prepare(
      'UPDATE accounts SET drive_access_token_enc = ?, drive_token_expires_at = ? WHERE id = ?',
    )
      .bind(encrypted, expiresAt, this.row.id)
      .run()
    this.row.drive_access_token_enc = encrypted
    this.row.drive_token_expires_at = expiresAt
    return token.access_token
  }

  private async folderId(token: string): Promise<string> {
    if (this.row.drive_folder_id) {
      return this.row.drive_folder_id
    }
    const folderId = await createDriveFolder(token)
    await this.env.DB.prepare('UPDATE accounts SET drive_folder_id = ? WHERE id = ?')
      .bind(folderId, this.row.id)
      .run()
    this.row.drive_folder_id = folderId
    return folderId
  }

  async put(objectKey: string, data: Uint8Array, contentType: string): Promise<PutResult> {
    const token = await this.accessToken()
    const folderId = await this.folderId(token)
    const boundary = `mc_${crypto.randomUUID()}`
    const name = objectKey.split('/').pop() ?? 'message.eml'
    const metadata = JSON.stringify({
      name,
      parents: [folderId],
      mimeType: contentType,
    })
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
    const tail = `\r\n--${boundary}--\r\n`
    const body = new Blob([head, data, tail])
    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    )
    const result = (await response.json()) as DriveFile
    if (!response.ok || !result.id) {
      throw new Error(result.error?.message ?? 'Google Drive upload failed')
    }
    return { key: result.id, size: data.byteLength }
  }

  async get(objectKey: string): Promise<GetResult | null> {
    const token = await this.accessToken()
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(objectKey)}?alt=media`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (response.status === 404) {
      return null
    }
    if (!response.ok || !response.body) {
      throw new Error(`Google Drive download failed (${response.status})`)
    }
    return {
      body: response.body,
      contentType: response.headers.get('Content-Type') ?? 'message/rfc822',
    }
  }

  async remove(objectKey: string): Promise<void> {
    const token = await this.accessToken()
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(objectKey)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    )
    if (!response.ok && response.status !== 404) {
      throw new Error(`Google Drive deletion failed (${response.status})`)
    }
  }
}
