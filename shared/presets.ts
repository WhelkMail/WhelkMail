import type { AuthType, MailSecurity } from './types'

export interface MailPreset {
  id: string
  label: string
  imapHost: string
  imapPort: number
  imapSecurity: MailSecurity
  smtpHost: string
  smtpPort: number
  smtpSecurity: MailSecurity
  authType: AuthType
  oauthProvider?: 'google' | 'microsoft'
  autoSavesSent: boolean
  maxAttachmentBytes: number
  note: string
}

export const MAIL_PRESETS: MailPreset[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
    authType: 'password',
    oauthProvider: 'google',
    autoSavesSent: true,
    maxAttachmentBytes: 15 * 1024 * 1024,
    note: 'Puoi usare OAuth Google oppure una password per app con verifica in due passaggi attiva.',
  },
  {
    id: 'outlook',
    label: 'Outlook / Microsoft 365',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    authType: 'oauth2',
    oauthProvider: 'microsoft',
    autoSavesSent: true,
    maxAttachmentBytes: 15 * 1024 * 1024,
    note: 'Microsoft non accetta più password per IMAP/SMTP: serve l’autorizzazione OAuth.',
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
    authType: 'password',
    autoSavesSent: true,
    maxAttachmentBytes: 15 * 1024 * 1024,
    note: 'Serve una password per app generata nelle impostazioni di sicurezza Yahoo.',
  },
  {
    id: 'icloud',
    label: 'iCloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    authType: 'password',
    autoSavesSent: true,
    maxAttachmentBytes: 15 * 1024 * 1024,
    note: 'Serve una password specifica per l’app generata su appleid.apple.com.',
  },
  {
    id: 'custom',
    label: 'Altro / IMAP generico',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: '',
    smtpPort: 465,
    smtpSecurity: 'tls',
    authType: 'password',
    autoSavesSent: false,
    maxAttachmentBytes: 15 * 1024 * 1024,
    note: 'Inserisci host e porte forniti dal tuo provider. Se non salva le inviate, il client fa APPEND in Sent.',
  },
]

export function findPreset(id: string | undefined): MailPreset | undefined {
  return MAIL_PRESETS.find((preset) => preset.id === id)
}

export interface RelayProviderOption {
  id: string
  label: string
  needsSecret: boolean
  needsDomain: boolean
}

export const RELAY_PROVIDERS: RelayProviderOption[] = [
  { id: 'smtp2go', label: 'SMTP2GO', needsSecret: false, needsDomain: false },
  { id: 'resend', label: 'Resend', needsSecret: false, needsDomain: false },
  { id: 'mailgun', label: 'Mailgun', needsSecret: false, needsDomain: true },
  { id: 'brevo', label: 'Brevo', needsSecret: false, needsDomain: false },
  { id: 'sendgrid', label: 'SendGrid', needsSecret: false, needsDomain: false },
  { id: 'mailjet', label: 'Mailjet', needsSecret: true, needsDomain: false },
  { id: 'postmark', label: 'Postmark', needsSecret: false, needsDomain: false },
]

export function findRelayProvider(id: string | undefined): RelayProviderOption | undefined {
  return RELAY_PROVIDERS.find((provider) => provider.id === id)
}
