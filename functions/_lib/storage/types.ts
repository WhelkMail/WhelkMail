import type { StorageDriver } from '../../../shared/types'

export interface PutResult {
  key: string
  size: number
}

export interface GetResult {
  body: ReadableStream
  contentType: string
}

export interface StorageAdapter {
  driver: StorageDriver
  put(objectKey: string, data: Uint8Array, contentType: string): Promise<PutResult>
  get(objectKey: string): Promise<GetResult | null>
  remove(objectKey: string): Promise<void>
}
