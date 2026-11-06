import type { Env } from '../env'
import type { GetResult, PutResult, StorageAdapter } from './types'

export class R2Storage implements StorageAdapter {
  driver = 'r2' as const
  private bucket: R2Bucket

  constructor(env: Env) {
    if (!env.BUCKET) {
      throw new Error('R2 non configurato su questo deployment')
    }
    this.bucket = env.BUCKET
  }

  async put(objectKey: string, data: Uint8Array, contentType: string): Promise<PutResult> {
    await this.bucket.put(objectKey, data, {
      httpMetadata: { contentType },
    })
    return { key: objectKey, size: data.byteLength }
  }

  async get(objectKey: string): Promise<GetResult | null> {
    const object = await this.bucket.get(objectKey)
    if (!object) {
      return null
    }
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? 'message/rfc822',
    }
  }

  async remove(objectKey: string): Promise<void> {
    await this.bucket.delete(objectKey)
  }
}
