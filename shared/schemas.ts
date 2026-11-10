import { z } from 'zod'

const email = z.string().trim().toLowerCase().pipe(z.string().email())
const security = z.enum(['tls', 'starttls'])
const noControl = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) {
      return false
    }
  }
  return true
}
const host = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value),
    'Invalid hostname',
  )
const safeText = (max: number) =>
  z.string().trim().min(1).max(max).refine(noControl, 'Invalid characters')

const imapAccountSchema = z.object({
  kind: z.literal('imap'),
  email,
  displayName: safeText(120),
  preset: z.string().trim().max(40).optional(),
  imapHost: host.optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecurity: security.optional(),
  smtpHost: host.optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecurity: security.optional(),
  username: safeText(255).optional(),
  authType: z.enum(['password', 'oauth2']).default('password'),
  oauthProvider: z.enum(['google', 'microsoft']).optional(),
  password: z.string().min(1).max(500).refine(noControl, 'Invalid characters').optional(),
  autoSavesSent: z.boolean().optional(),
  incomingLabelName: safeText(40).optional(),
})

const relayAccountSchema = z.object({
  kind: z.literal('relay'),
  email,
  displayName: safeText(120),
  storageDriver: z.enum(['drive', 'r2']).default('drive'),
  relayProvider: safeText(40).default('smtp2go'),
  relayApiKey: z.string().trim().min(1).max(2000).refine(noControl, 'Invalid characters').optional(),
  relayApiSecret: z.string().trim().max(2000).refine(noControl, 'Invalid characters').optional(),
  relayDomain: z.string().trim().max(255).refine(noControl, 'Invalid characters').optional(),
  relayRegion: z.enum(['us', 'eu']).optional(),
  smtpHost: host.optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecurity: security.optional(),
  username: safeText(255).optional(),
  incomingLabelName: safeText(40).optional(),
})

export const accountCreateSchema = z.discriminatedUnion('kind', [
  imapAccountSchema,
  relayAccountSchema,
])

export const accountUpdateSchema = z.object({
  displayName: safeText(120).optional(),
  signature: z.string().max(5000).optional(),
  incomingLabelId: z.string().min(1).nullable().optional(),
  archiveImapBodies: z.boolean().optional(),
  imapArchiveDriver: z.enum(['r2', 'drive']).optional(),
  deleteAfterArchive: z.boolean().optional(),
  autoSync: z.boolean().optional(),
  sentFolder: safeText(255).optional(),
  autoSavesSent: z.boolean().optional(),
  storageDriver: z.enum(['provider', 'drive', 'r2']).optional(),
  password: z.string().min(1).max(500).refine(noControl, 'Invalid characters').optional(),
  username: safeText(255).optional(),
  imapHost: host.optional(),
  imapPort: z.number().int().min(1).max(65535).optional(),
  imapSecurity: security.optional(),
  smtpHost: host.optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecurity: security.optional(),
  relayProvider: safeText(40).optional(),
  relayApiKey: z.string().trim().min(1).max(2000).refine(noControl, 'Invalid characters').optional(),
  relayApiSecret: z.string().trim().max(2000).refine(noControl, 'Invalid characters').optional(),
  relayDomain: z.string().trim().max(255).refine(noControl, 'Invalid characters').optional(),
  relayRegion: z.enum(['us', 'eu']).optional(),
})

export const attachmentInputSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200).default('application/octet-stream'),
  dataBase64: z.string().min(1).max(21_000_000),
})

export const draftSchema = z.object({
  accountId: z.string().min(1),
  draftId: z.string().optional(),
  to: z.array(email).max(50).default([]),
  cc: z.array(email).max(50).default([]),
  bcc: z.array(email).max(50).default([]),
  subject: z.string().max(500).default(''),
  text: z.string().max(1_000_000).default(''),
  html: z.string().max(2_000_000).optional(),
  attachments: z.array(attachmentInputSchema).max(20).default([]),
})

export const sendSchema = z.object({
  accountId: z.string().min(1),
  draftId: z.string().optional(),
  to: z.array(email).min(1).max(50),
  cc: z.array(email).max(50).default([]),
  bcc: z.array(email).max(50).default([]),
  subject: z.string().max(500).default(''),
  text: z.string().max(1_000_000).default(''),
  html: z.string().max(2_000_000).optional(),
  attachments: z.array(attachmentInputSchema).max(20).default([]),
})

export type SendInput = z.infer<typeof sendSchema>

export const labelColorSchema = z.enum([
  'blue',
  'emerald',
  'amber',
  'violet',
  'rose',
  'cyan',
  'lime',
])

export const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: labelColorSchema.default('blue'),
})

export const labelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: labelColorSchema.optional(),
})

const optionalPattern = z.string().trim().max(255).optional().nullable()

export const filterCreateSchema = z.object({
  name: z.string().trim().max(80).optional(),
  from: optionalPattern,
  to: optionalPattern,
  subject: optionalPattern,
  hasWords: optionalPattern,
  doesntHave: optionalPattern,
  hasAttachment: z.boolean().optional(),
  labelIds: z.array(z.string().min(1).max(64)).max(20).optional(),
  forwardTo: z.array(email).max(20).optional(),
  enabled: z.boolean().optional(),
})

export const filterUpdateSchema = filterCreateSchema.partial()

export const messageLabelsSchema = z.object({
  labelIds: z.array(z.string().min(1).max(64)).max(30),
})

export const contactCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  note: z.string().trim().max(1000).optional(),
})

export const contactUpdateSchema = contactCreateSchema.partial()

export const pushSubscribeSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine((value) => {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    }, 'Push endpoint must be https'),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  userAgent: z.string().max(300).optional(),
})

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
})

export const pushPrefsSchema = z.object({
  accountId: z.string().min(1),
  enabled: z.boolean().optional(),
  folders: z.array(z.enum(['inbox', 'sent', 'draft'])).max(3).optional(),
})

export const appSettingsSchema = z.object({
  defaultSignature: z.string().max(5000).optional(),
  signatureMode: z.enum(['shared', 'per_account']).optional(),
  allowRemoteImages: z.boolean().optional(),
  metadataRetentionDays: z.number().int().min(0).max(3650).optional(),
})

