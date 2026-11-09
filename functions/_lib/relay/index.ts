import { decryptString } from '../crypto'
import type { AccountRow } from '../db'
import type { Env } from '../env'
import type { SmtpSecurity } from '../smtp/client'
import { BrevoRelay } from './brevo'
import { CustomSmtpRelay } from './custom'
import { MailgunRelay } from './mailgun'
import { MailjetRelay } from './mailjet'
import { PostmarkRelay } from './postmark'
import { ResendRelay } from './resend'
import { SendGridRelay } from './sendgrid'
import { Smtp2GoRelay } from './smtp2go'
import type { RelayAdapter } from './types'

const DEFAULT_PROVIDER = 'smtp2go'

const LABELS: Record<string, string> = {
  smtp2go: 'SMTP2GO',
  resend: 'Resend',
  mailgun: 'Mailgun',
  brevo: 'Brevo',
  sendgrid: 'SendGrid',
  mailjet: 'Mailjet',
  postmark: 'Postmark',
  custom: 'SMTP personalizzato',
}

const MAX_ATTACHMENT_BYTES: Record<string, number> = {
  smtp2go: 15 * 1024 * 1024,
  resend: 15 * 1024 * 1024,
  mailgun: 15 * 1024 * 1024,
  brevo: 8 * 1024 * 1024,
  sendgrid: 15 * 1024 * 1024,
  mailjet: 12 * 1024 * 1024,
  postmark: 15 * 1024 * 1024,
  custom: 15 * 1024 * 1024,
}

export interface RelayInfo {
  provider: string
  label: string
  configured: boolean
  maxAttachmentBytes: number
}

function envProvider(env: Env): string {
  return (env.RELAY_PROVIDER ?? DEFAULT_PROVIDER).trim().toLowerCase()
}

function envKey(env: Env, provider: string): string | undefined {
  return env.RELAY_API_KEY ?? (provider === 'smtp2go' ? env.SMTP2GO_API_KEY : undefined)
}

export function relayInfo(env: Env): RelayInfo {
  const provider = envProvider(env)
  const key = envKey(env, provider)
  let configured = Boolean(key) && Boolean(LABELS[provider])
  if (provider === 'mailgun') {
    configured = configured && Boolean(env.MAILGUN_DOMAIN)
  }
  if (provider === 'mailjet') {
    configured = configured && Boolean(env.RELAY_API_SECRET)
  }
  return {
    provider,
    label: LABELS[provider] ?? provider,
    configured,
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES[provider] ?? 15 * 1024 * 1024,
  }
}

export async function getRelay(env: Env, account?: AccountRow): Promise<RelayAdapter> {
  const provider = (account?.relay_provider ?? envProvider(env)).trim().toLowerCase()
  let key = envKey(env, provider)
  if (account?.relay_api_key_enc) {
    key = await decryptString(env, account.relay_api_key_enc)
  }
  let secret = env.RELAY_API_SECRET
  if (account?.relay_api_secret_enc) {
    secret = await decryptString(env, account.relay_api_secret_enc)
  }
  const domain = account?.relay_domain ?? env.MAILGUN_DOMAIN
  const region = account?.relay_region ?? env.MAILGUN_REGION ?? 'us'

  if (provider === 'custom') {
    if (!account?.smtp_host || !account.smtp_port || !account.smtp_security) {
      throw new Error('Configurazione SMTP personalizzata mancante')
    }
    return new CustomSmtpRelay({
      host: account.smtp_host,
      port: account.smtp_port,
      security: account.smtp_security as SmtpSecurity,
      username: account.username ?? account.email,
      password: key ?? '',
    })
  }

  if (!key) {
    throw new Error(`Chiave API relay non configurata per ${provider}`)
  }
  switch (provider) {
    case 'smtp2go':
      return new Smtp2GoRelay(key)
    case 'resend':
      return new ResendRelay(key)
    case 'mailgun':
      if (!domain) {
        throw new Error('Dominio Mailgun non configurato')
      }
      return new MailgunRelay(key, domain, region)
    case 'brevo':
      return new BrevoRelay(key)
    case 'sendgrid':
      return new SendGridRelay(key)
    case 'mailjet':
      if (!secret) {
        throw new Error('Secret Mailjet non configurato')
      }
      return new MailjetRelay(key, secret)
    case 'postmark':
      return new PostmarkRelay(key)
    default:
      throw new Error(`Provider relay non supportato: ${provider}`)
  }
}

export type { RelayAdapter, RelayMessage } from './types'
