export interface RelayAttachment {
  filename: string
  contentType: string
  content: Uint8Array
}

export interface RelayMessage {
  fromName: string
  fromEmail: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html?: string
  attachments: RelayAttachment[]
}

export interface RelayResult {
  providerMessageId: string | null
}

export interface RelayAdapter {
  provider: string
  label: string
  maxAttachmentBytes: number
  send(message: RelayMessage): Promise<RelayResult>
}
