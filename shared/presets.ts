import type { AuthType, MailSecurity } from './types'

export interface MailPreset {
  id: string
  // Shown as-is unless labelKey is set; use labelKey for anything that isn't a
  // brand name, so it follows the UI language.
  label: string
  labelKey?: string
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
  // i18n key for the setup hint shown under the preset picker.
  noteKey: string
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
    noteKey: 'presets.gmail.note',
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
    noteKey: 'presets.outlook.note',
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
    noteKey: 'presets.yahoo.note',
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
    noteKey: 'presets.icloud.note',
  },
  {
    id: 'custom',
    label: 'Altro / IMAP generico',
    labelKey: 'presets.custom.label',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: '',
    smtpPort: 465,
    smtpSecurity: 'tls',
    authType: 'password',
    autoSavesSent: false,
    maxAttachmentBytes: 15 * 1024 * 1024,
    noteKey: 'presets.custom.note',
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
  manual?: boolean
  // As MailPreset.labelKey: set when the label isn't a brand name.
  labelKey?: string
  // What the relayDomain field holds when needsDomain is set, which picks its
  // label and error message: a sending domain (default) or an account ID.
  domainLabel?: 'domain' | 'accountId'
}

export const RELAY_PROVIDERS: RelayProviderOption[] = [
  { id: 'smtp2go', label: 'SMTP2GO', needsSecret: false, needsDomain: false },
  { id: 'resend', label: 'Resend', needsSecret: false, needsDomain: false },
  { id: 'mailgun', label: 'Mailgun', needsSecret: false, needsDomain: true },
  { id: 'brevo', label: 'Brevo', needsSecret: false, needsDomain: false },
  { id: 'sendgrid', label: 'SendGrid', needsSecret: false, needsDomain: false },
  { id: 'mailjet', label: 'Mailjet', needsSecret: true, needsDomain: false },
  { id: 'postmark', label: 'Postmark', needsSecret: false, needsDomain: false },
  { id: 'cloudflare', label: 'Cloudflare Email Service', needsSecret: false, needsDomain: true, domainLabel: 'accountId' },
  { id: 'custom', label: 'SMTP personalizzato', labelKey: 'relayProviders.custom.label', needsSecret: false, needsDomain: false, manual: true },
]

export function findRelayProvider(id: string | undefined): RelayProviderOption | undefined {
  return RELAY_PROVIDERS.find((provider) => provider.id === id)
}
