import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  HardDrive,
  LogOut,
  PlugZap,
  Plus,
  Server,
  Trash2,
} from 'lucide-react'
import { RELAY_PROVIDERS, findRelayProvider } from '../../shared/presets'
import type {
  Account,
  AccountPatch,
  FilterInput,
  HealthStatus,
  Label,
  LabelColor,
  MailFilter,
  MailSecurity,
  SignatureMode,
  StorageOptions,
} from '../../shared/types'
import { LOCALES, useI18n, type Locale } from '../i18n'
import { cn, formatBytes } from '../lib/utils'
import { DeletionPanel } from './DeletionPanel'
import { FiltersSettings } from './FiltersSettings'
import { PushSettings } from './PushSettings'
import { SyncPanel } from './SyncPanel'
import { TwoFactorSettings } from './TwoFactorSettings'

/** Retention choices offered in Settings; 0 (keep everything) is the default. */
const RETENTION_OPTIONS = [30, 90, 180, 365, 730]

interface SettingsProps {
  accounts: Account[]
  labels: Label[]
  filters: MailFilter[]
  storage: StorageOptions
  health: HealthStatus | null
  busyId: string | null
  error: string | null
  onCreateFilter: (input: FilterInput) => Promise<boolean>
  onUpdateFilter: (id: string, input: FilterInput) => void
  onDeleteFilter: (id: string) => void
  onCreateLabel: (name: string, color: LabelColor) => Promise<Label | null>
  onUpdate: (id: string, patch: AccountPatch) => Promise<void>
  onTest: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onConnectDrive: (id: string) => void
  onConnectOAuth: (id: string, provider: 'google' | 'microsoft') => void
  onAddAccount: () => void
  readingPane: boolean
  onReadingPaneChange: (value: boolean) => void
  allowRemoteImages: boolean
  onAllowRemoteImagesChange: (value: boolean) => void
  metadataRetentionDays: number
  onMetadataRetentionChange: (value: number) => void
  defaultSenderNew: string
  onDefaultSenderNewChange: (value: string) => void
  defaultSenderReply: string
  onDefaultSenderReplyChange: (value: string) => void
  defaultSignature: string
  onDefaultSignatureChange: (value: string) => void
  signatureMode: SignatureMode
  onSignatureModeChange: (value: SignatureMode) => void
  onSyncComplete: () => void
  onLogout: () => void
}

function ConfigBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]',
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
      )}
    >
      {ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
      {label}
    </span>
  )
}

interface AccountCardProps {
  account: Account
  accounts: Account[]
  labels: Label[]
  storage: StorageOptions
  busy: boolean
  onSyncComplete: () => void
  onUpdate: (id: string, patch: AccountPatch) => Promise<void>
  onTest: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onConnectDrive: (id: string) => void
  onConnectOAuth: (id: string, provider: 'google' | 'microsoft') => void
}

function AccountCard({
  account,
  accounts,
  labels,
  storage,
  busy,
  onSyncComplete,
  onUpdate,
  onTest,
  onDelete,
  onConnectDrive,
  onConnectOAuth,
}: AccountCardProps) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [sentFolder, setSentFolder] = useState(account.sentFolder)
  const [imapHost, setImapHost] = useState(account.imapHost ?? '')
  const [imapPort, setImapPort] = useState(String(account.imapPort ?? 993))
  const [imapSecurity, setImapSecurity] = useState<MailSecurity>(account.imapSecurity ?? 'tls')
  const [smtpHost, setSmtpHost] = useState(account.smtpHost ?? '')
  const [smtpPort, setSmtpPort] = useState(String(account.smtpPort ?? 465))
  const [smtpSecurity, setSmtpSecurity] = useState<MailSecurity>(account.smtpSecurity ?? 'tls')
  const [username, setUsername] = useState(account.username)
  const [relayProvider, setRelayProvider] = useState(account.relayProvider ?? 'smtp2go')
  const [relayApiKey, setRelayApiKey] = useState('')
  const [relayApiSecret, setRelayApiSecret] = useState('')
  const [relayDomain, setRelayDomain] = useState('')
  const [relayRegion, setRelayRegion] = useState('us')
  const isImap = account.kind === 'imap'
  const relayMeta = findRelayProvider(relayProvider)
  const sentCopyTargets = accounts.filter(
    (item) => item.kind === 'imap' && item.id !== account.id && item.connected,
  )

  async function saveConnection() {
    await onUpdate(account.id, {
      imapHost: imapHost.trim(),
      imapPort: Number(imapPort),
      imapSecurity,
      smtpHost: smtpHost.trim(),
      smtpPort: Number(smtpPort),
      smtpSecurity,
      username: username.trim(),
    })
  }

  async function saveRelay() {
    await onUpdate(account.id, {
      relayProvider,
      relayApiKey: relayApiKey.trim() || undefined,
      relayApiSecret: relayApiSecret.trim() || undefined,
      relayDomain: relayDomain.trim() || undefined,
      relayRegion: relayRegion === 'eu' ? 'eu' : 'us',
      ...(relayMeta?.manual
        ? {
            smtpHost: smtpHost.trim(),
            smtpPort: Number(smtpPort),
            smtpSecurity,
            username: username.trim(),
          }
        : {}),
    })
    setRelayApiKey('')
    setRelayApiSecret('')
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{account.displayName}</p>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
              {isImap ? t('settings.kindImap') : t('settings.kindRelay')}
            </span>
            {isImap ? (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  account.connected ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-brand-strong',
                )}
              >
                {account.connected ? t('settings.connected') : t('settings.notConnected')}
              </span>
            ) : (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  account.relayConfigured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
                )}
              >
                {account.relayConfigured ? t('settings.relayConfigured') : t('settings.relayNotConfigured')}
              </span>
            )}
          </div>
          <p className="text-sm text-muted">{account.email}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDelete(account.id)}
          className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:border-red-200 hover:text-brand-strong disabled:opacity-50"
        >
          <Trash2 size={14} /> {t('settings.delete')}
        </button>
      </div>

      <label className="mt-4 block rounded-xl bg-slate-50 p-3 text-xs">
        <span className="mb-1 block font-medium text-slate-700">{t('settings.incomingLabel')}</span>
        <select
          value={account.incomingLabelId ?? ''}
          disabled={busy}
          onChange={(event) =>
            void onUpdate(account.id, { incomingLabelId: event.target.value || null })
          }
          className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none disabled:opacity-50"
        >
          <option value="">{t('settings.incomingLabelNone')}</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-muted">{t('settings.incomingLabelHint')}</span>
      </label>

      {isImap ? (
        <SyncPanel account={account} onSynced={onSyncComplete} onUpdate={onUpdate} />
      ) : null}

      {isImap ? (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-slate-700">
                {account.driveConnected
                  ? t('settings.driveConnected')
                  : t('settings.driveNotConnected')}
              </p>
              <p className="text-muted">
                {account.driveConnected
                  ? t('settings.driveFolderReady')
                  : t('settings.driveAuthNeeded')}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onConnectDrive(account.id)}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 hover:border-slate-300 disabled:opacity-50"
            >
              {account.driveConnected ? t('settings.reconnectDrive') : t('settings.connectDrive')}
            </button>
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={account.archiveImapBodies}
              disabled={busy || (!storage.r2 && !account.driveConnected)}
              onChange={(event) =>
                void onUpdate(account.id, { archiveImapBodies: event.target.checked })
              }
              className="mt-0.5 h-3.5 w-3.5"
            />
            <span>
              <span className="block font-medium text-slate-700">
                {t('settings.archiveBodies')}
              </span>
              <span className="text-muted">
                {storage.r2 || account.driveConnected
                  ? t('settings.archiveBodiesHint')
                  : t('settings.archiveBodiesUnavailable')}
              </span>
            </span>
          </label>

          {account.archiveImapBodies ? (
            <div className="mt-3">
              <p className="mb-1.5 font-medium text-muted">{t('settings.archiveDestination')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !storage.r2}
                  onClick={() => void onUpdate(account.id, { imapArchiveDriver: 'r2' })}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5',
                    account.imapArchiveDriver === 'r2'
                      ? 'border-brand bg-brand-soft text-brand-strong'
                      : 'border-line bg-white hover:border-slate-300',
                    !storage.r2 && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {t('settings.r2')}
                </button>
                <button
                  type="button"
                  disabled={busy || !account.driveConnected}
                  onClick={() => void onUpdate(account.id, { imapArchiveDriver: 'drive' })}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5',
                    account.imapArchiveDriver === 'drive'
                      ? 'border-brand bg-brand-soft text-brand-strong'
                      : 'border-line bg-white hover:border-slate-300',
                    !account.driveConnected && 'cursor-not-allowed opacity-50',
                  )}
                >
                  {t('settings.drive')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {isImap ? (
        <DeletionPanel account={account} busy={busy} onUpdate={onUpdate} />
      ) : null}

      {isImap ? (
        <>
          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="mb-1 font-medium text-slate-700">{t('settings.imap')}</p>
              <p className="text-muted">
                {account.imapHost}:{account.imapPort} · {account.imapSecurity}
              </p>
              <p className="text-muted">{t('settings.user', { value: account.username })}</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="mb-1 font-medium text-slate-700">{t('settings.smtp')}</p>
              <p className="text-muted">
                {account.smtpHost}:{account.smtpPort} · {account.smtpSecurity}
              </p>
              <p className="text-muted">
                {t('settings.maxAttachments', { value: formatBytes(account.maxAttachmentBytes) })}
              </p>
            </div>
          </div>

          <details className="mt-4 rounded-xl border border-line p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              {t('settings.connection')}
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted">IMAP</p>
                <input
                  value={imapHost}
                  onChange={(event) => setImapHost(event.target.value)}
                  placeholder="imap.esempio.it"
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                />
                <div className="flex gap-2">
                  <input
                    value={imapPort}
                    onChange={(event) => setImapPort(event.target.value)}
                    inputMode="numeric"
                    className="w-20 rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                  />
                  <select
                    value={imapSecurity}
                    onChange={(event) => setImapSecurity(event.target.value as MailSecurity)}
                    className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none"
                  >
                    <option value="tls">TLS (993)</option>
                    <option value="starttls">STARTTLS (143)</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted">SMTP</p>
                <input
                  value={smtpHost}
                  onChange={(event) => setSmtpHost(event.target.value)}
                  placeholder="smtp.esempio.it"
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                />
                <div className="flex gap-2">
                  <input
                    value={smtpPort}
                    onChange={(event) => setSmtpPort(event.target.value)}
                    inputMode="numeric"
                    className="w-20 rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                  />
                  <select
                    value={smtpSecurity}
                    onChange={(event) => setSmtpSecurity(event.target.value as MailSecurity)}
                    className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none"
                  >
                    <option value="tls">TLS (465)</option>
                    <option value="starttls">STARTTLS (587)</option>
                  </select>
                </div>
              </div>
              <label className="block text-xs sm:col-span-2">
                <span className="mb-1 block font-medium text-muted">{t('settings.username')}</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                />
              </label>
            </div>
            {account.authType === 'oauth2' ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                {t('settings.oauthHostWarning')}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveConnection()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {t('settings.saveConnection')}
              </button>
            </div>
          </details>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-muted">{t('settings.sentFolder')}</span>
              <div className="flex gap-2">
                <input
                  value={sentFolder}
                  onChange={(event) => setSentFolder(event.target.value)}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                />
                <button
                  type="button"
                  disabled={busy || sentFolder === account.sentFolder}
                  onClick={() => void onUpdate(account.id, { sentFolder })}
                  className="rounded-lg border border-line px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                >
                  {t('common.save')}
                </button>
              </div>
            </label>
          </div>

          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
            <p className="mb-2 font-medium text-slate-700">{t('settings.sentCopy')}</p>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name={`sent-mode-${account.id}`}
                checked={account.autoSavesSent}
                disabled={busy}
                onChange={() => void onUpdate(account.id, { autoSavesSent: true })}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>{t('settings.sentProvider')}</span>
            </label>
            <label className="mt-1 flex items-start gap-2">
              <input
                type="radio"
                name={`sent-mode-${account.id}`}
                checked={!account.autoSavesSent}
                disabled={busy}
                onChange={() => void onUpdate(account.id, { autoSavesSent: false })}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>{t('settings.sentClient')}</span>
            </label>
            <p className="mt-2 text-[11px] text-muted">{t('settings.sentHint')}</p>
          </div>

          {account.authType === 'password' ? (
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <label className="block flex-1 text-xs">
                <span className="mb-1 block font-medium text-muted">{t('settings.updatePassword')}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                />
              </label>
              <button
                type="button"
                disabled={busy || !password}
                onClick={async () => {
                  await onUpdate(account.id, { password })
                  setPassword('')
                }}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {t('settings.savePassword')}
              </button>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onTest(account.id)}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              <PlugZap size={14} /> {t('settings.testConnection')}
            </button>
            {account.authType === 'oauth2' ? (
              <button
                type="button"
                onClick={() => onConnectOAuth(account.id, account.oauthProvider ?? 'microsoft')}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700"
              >
                <Server size={14} />
                {account.oauthProvider === 'google'
                  ? account.connected
                    ? t('settings.reconnectGoogle')
                    : t('settings.connectGoogle')
                  : account.connected
                    ? t('settings.reconnectMicrosoft')
                    : t('settings.connectMicrosoft')}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted">{t('settings.storage')}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onUpdate(account.id, { storageDriver: 'drive' })}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                  account.storageDriver === 'drive'
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line hover:border-slate-300',
                )}
              >
                <Cloud size={14} /> {t('settings.drive')}
              </button>
              <button
                type="button"
                disabled={busy || !storage.r2}
                onClick={() => void onUpdate(account.id, { storageDriver: 'r2' })}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                  account.storageDriver === 'r2'
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line hover:border-slate-300',
                  !storage.r2 && 'cursor-not-allowed opacity-50',
                )}
              >
                <HardDrive size={14} /> {t('settings.r2')}
              </button>
              <button
                type="button"
                disabled={
                  busy || (!account.sentCopyAccountId && sentCopyTargets.length === 0)
                }
                onClick={() => {
                  const target = account.sentCopyAccountId ?? sentCopyTargets[0]?.id
                  if (target) {
                    void onUpdate(account.id, { storageDriver: 'imap', sentCopyAccountId: target })
                  }
                }}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                  account.storageDriver === 'imap'
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-line hover:border-slate-300',
                  !account.sentCopyAccountId &&
                    sentCopyTargets.length === 0 &&
                    'cursor-not-allowed opacity-50',
                )}
              >
                <Server size={14} /> {t('settings.sentCopyMailbox')}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-line p-3">
            <label className="block text-xs">
              <span className="mb-1 block font-medium text-muted">
                {t('settings.sentCopyTarget')}
              </span>
              <select
                value={account.storageDriver === 'imap' ? account.sentCopyAccountId ?? '' : ''}
                disabled={busy}
                onChange={(event) => {
                  const value = event.target.value
                  if (value) {
                    void onUpdate(account.id, { storageDriver: 'imap', sentCopyAccountId: value })
                  } else if (account.storageDriver === 'imap') {
                    void onUpdate(account.id, { storageDriver: 'drive' })
                  }
                }}
                className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none disabled:opacity-50"
              >
                <option value="">{t('settings.sentCopyTargetNone')}</option>
                {sentCopyTargets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.displayName} — {target.email} · {target.sentFolder}
                  </option>
                ))}
              </select>
            </label>
            <span className="mt-1 block text-[11px] text-muted">
              {sentCopyTargets.length > 0
                ? t('settings.sentCopyTargetHint')
                : t('settings.sentCopyTargetEmpty')}
            </span>
          </div>

          <div className="mt-4 rounded-xl border border-line p-3">
            <p className="mb-2 text-xs font-medium text-muted">{t('settings.relayProvider')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={relayProvider}
                onChange={(event) => setRelayProvider(event.target.value)}
                className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none"
              >
                {RELAY_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <input
                type="password"
                value={relayApiKey}
                onChange={(event) => setRelayApiKey(event.target.value)}
                placeholder={
                  relayMeta?.manual
                    ? t('settings.relayPasswordPlaceholder')
                    : t('settings.relayApiKeyPlaceholder')
                }
                className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
              {relayMeta?.manual ? (
                <>
                  <input
                    value={smtpHost}
                    onChange={(event) => setSmtpHost(event.target.value)}
                    placeholder={t('settings.smtpHost')}
                    className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                  />
                  <div className="flex gap-2">
                    <input
                      value={smtpPort}
                      onChange={(event) => setSmtpPort(event.target.value)}
                      inputMode="numeric"
                      placeholder={t('settings.port')}
                      className="w-20 rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                    />
                    <select
                      value={smtpSecurity}
                      onChange={(event) =>
                        setSmtpSecurity(event.target.value as MailSecurity)
                      }
                      className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs outline-none"
                    >
                      <option value="tls">TLS</option>
                      <option value="starttls">STARTTLS</option>
                    </select>
                  </div>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={t('settings.username')}
                    className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                  />
                </>
              ) : null}
              {relayMeta?.needsSecret ? (
                <input
                  type="password"
                  value={relayApiSecret}
                  onChange={(event) => setRelayApiSecret(event.target.value)}
                  placeholder={t('settings.relayApiSecret')}
                  className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                />
              ) : null}
              {relayMeta?.needsDomain ? (
                <div className="flex gap-2">
                  <input
                    value={relayDomain}
                    onChange={(event) => setRelayDomain(event.target.value)}
                    placeholder={t('settings.relayDomain')}
                    className="w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                  />
                  <select
                    value={relayRegion}
                    onChange={(event) => setRelayRegion(event.target.value)}
                    className="rounded-lg border border-line px-2 py-1.5 text-xs outline-none"
                  >
                    <option value="us">US</option>
                    <option value="eu">EU</option>
                  </select>
                </div>
              ) : null}
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted">
                {account.relayConfigured ? t('settings.relayConfigured') : t('settings.relayNotConfigured')}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveRelay()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {t('settings.saveRelay')}
              </button>
            </div>
          </div>

          {account.storageDriver === 'drive' ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="text-xs">
                <p className="font-medium text-slate-700">
                  {account.driveConnected ? t('settings.driveConnected') : t('settings.driveNotConnected')}
                </p>
                <p className="text-muted">
                  {account.driveConnected ? t('settings.driveFolderReady') : t('settings.driveAuthNeeded')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onConnectDrive(account.id)}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"
              >
                {account.driveConnected ? t('settings.reconnectDrive') : t('settings.connectDrive')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

interface AccountSignatureEditorProps {
  account: Account
  busy: boolean
  onUpdate: (id: string, patch: AccountPatch) => Promise<void>
}

function AccountSignatureEditor({ account, busy, onUpdate }: AccountSignatureEditorProps) {
  const { t } = useI18n()
  const [value, setValue] = useState(account.signature)
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="mb-1 text-xs font-medium text-slate-700">
        {account.displayName} <span className="font-normal text-muted">&lt;{account.email}&gt;</span>
      </p>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={3}
        placeholder={t('settings.signaturePlaceholder')}
        className="w-full resize-y rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
      />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          disabled={busy || value === account.signature}
          onClick={() => void onUpdate(account.id, { signature: value })}
          className="rounded-lg border border-line px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}

export function Settings({
  accounts,
  labels,
  filters,
  storage,
  health,
  busyId,
  error,
  onCreateFilter,
  onUpdateFilter,
  onDeleteFilter,
  onCreateLabel,
  onUpdate,
  onTest,
  onDelete,
  onConnectDrive,
  onConnectOAuth,
  onAddAccount,
  readingPane,
  onReadingPaneChange,
  allowRemoteImages,
  onAllowRemoteImagesChange,
  metadataRetentionDays,
  onMetadataRetentionChange,
  defaultSenderNew,
  onDefaultSenderNewChange,
  defaultSenderReply,
  onDefaultSenderReplyChange,
  defaultSignature,
  onDefaultSignatureChange,
  signatureMode,
  onSignatureModeChange,
  onSyncComplete,
  onLogout,
}: SettingsProps) {
  const { t, locale, setLocale } = useI18n()
  const [signatureDraft, setSignatureDraft] = useState(defaultSignature)
  const [tab, setTab] = useState<
    'accounts' | 'general' | 'signatures' | 'filters' | 'notifications' | 'security' | 'system'
  >('accounts')
  const tabs = [
    { id: 'accounts' as const, label: t('settings.tabAccounts') },
    { id: 'general' as const, label: t('settings.tabGeneral') },
    { id: 'signatures' as const, label: t('settings.tabSignatures') },
    { id: 'filters' as const, label: t('settings.tabFilters') },
    { id: 'notifications' as const, label: t('settings.tabNotifications') },
    { id: 'security' as const, label: t('settings.tabSecurity') },
    { id: 'system' as const, label: t('settings.tabSystem') },
  ]

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4">
          <h2 className="text-lg font-medium">{t('settings.title')}</h2>
        </div>

        <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                'shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                tab === item.id
                  ? 'border-brand text-brand-strong'
                  : 'border-transparent text-muted hover:text-slate-700',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-brand-strong">{error}</p> : null}

        {tab === 'accounts' ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onAddAccount}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-strong"
              >
                <Plus size={14} /> {t('settings.addAccount')}
              </button>
            </div>
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                accounts={accounts}
                labels={labels}
                storage={storage}
                busy={busyId === account.id}
                onSyncComplete={onSyncComplete}
                onUpdate={onUpdate}
                onTest={onTest}
                onDelete={onDelete}
                onConnectDrive={onConnectDrive}
                onConnectOAuth={onConnectOAuth}
              />
            ))}
          </div>
        ) : null}

        {tab === 'general' ? (
          <>
            <div className="rounded-2xl border border-line bg-white p-5">
              <label className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-slate-700">{t('settings.language')}</span>
                <select
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as Locale)}
                  className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none"
                >
                  {LOCALES.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 rounded-2xl border border-line bg-white p-5">
              <p className="mb-3 text-sm font-medium">{t('settings.layout')}</p>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={readingPane}
                  onChange={(event) => onReadingPaneChange(event.target.checked)}
                  className="h-4 w-4"
                />
                {t('settings.readingPane')}
              </label>
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={allowRemoteImages}
                  onChange={(event) => onAllowRemoteImagesChange(event.target.checked)}
                  className="h-4 w-4"
                />
                {t('settings.remoteImages')}
              </label>
              <p className="mt-1 text-[11px] text-muted">{t('settings.remoteImagesHint')}</p>
              <label className="mt-3 block text-xs">
                <span className="mb-1 block font-medium text-muted">
                  {t('settings.retention')}
                </span>
                <select
                  value={String(metadataRetentionDays)}
                  onChange={(event) => onMetadataRetentionChange(Number(event.target.value))}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="0">{t('settings.retentionForever')}</option>
                  {RETENTION_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {t('settings.retentionDays', { days })}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted">{t('settings.retentionHint')}</p>
              </label>
            </div>

            <div className="mt-3 rounded-2xl border border-line bg-white p-5">
              <p className="mb-3 text-sm font-medium">{t('settings.defaultSender')}</p>
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-muted">
                  {t('settings.defaultSenderNew')}
                </span>
                <select
                  value={defaultSenderNew}
                  onChange={(event) => onDefaultSenderNewChange(event.target.value)}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="auto">{t('settings.defaultSenderNewAuto')}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName} &lt;{account.email}&gt;
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block text-xs">
                <span className="mb-1 block font-medium text-muted">
                  {t('settings.defaultSenderReply')}
                </span>
                <select
                  value={defaultSenderReply}
                  onChange={(event) => onDefaultSenderReplyChange(event.target.value)}
                  className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="auto">{t('settings.defaultSenderReplyAuto')}</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName} &lt;{account.email}&gt;
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-[11px] text-muted">{t('settings.defaultSenderHint')}</p>
            </div>
          </>
        ) : null}

        {tab === 'signatures' ? (
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="mb-3 text-sm font-medium">{t('settings.signature')}</p>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
              <input
                type="radio"
                name="signature-mode"
                checked={signatureMode === 'shared'}
                onChange={() => onSignatureModeChange('shared')}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>
                <span className="block font-medium">{t('settings.signatureShared')}</span>
                <span className="text-muted">{t('settings.signatureSharedHint')}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-700">
              <input
                type="radio"
                name="signature-mode"
                checked={signatureMode === 'per_account'}
                onChange={() => onSignatureModeChange('per_account')}
                className="mt-0.5 h-3.5 w-3.5"
              />
              <span>
                <span className="block font-medium">{t('settings.signaturePerAccount')}</span>
                <span className="text-muted">{t('settings.signaturePerAccountHint')}</span>
              </span>
            </label>
          </div>

          {signatureMode === 'shared' ? (
            <div className="mt-4">
              <label className="block text-xs">
                <span className="mb-1 block font-medium text-muted">
                  {t('settings.defaultSignature')}
                </span>
                <textarea
                  value={signatureDraft}
                  onChange={(event) => setSignatureDraft(event.target.value)}
                  rows={4}
                  placeholder={t('settings.signaturePlaceholder')}
                  className="w-full resize-y rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted">{t('settings.defaultSignatureHint')}</p>
                <button
                  type="button"
                  disabled={signatureDraft === defaultSignature}
                  onClick={() => onDefaultSignatureChange(signatureDraft)}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {accounts.map((account) => (
                <AccountSignatureEditor
                  key={account.id}
                  account={account}
                  busy={busyId === account.id}
                  onUpdate={onUpdate}
                />
              ))}
            </div>
          )}
          </div>
        ) : null}

        {tab === 'filters' ? (
          <FiltersSettings
            labels={labels}
            filters={filters}
            onCreateFilter={onCreateFilter}
            onUpdateFilter={onUpdateFilter}
            onDeleteFilter={onDeleteFilter}
            onCreateLabel={onCreateLabel}
          />
        ) : null}

        {tab === 'notifications' ? <PushSettings /> : null}

        {tab === 'security' ? <TwoFactorSettings /> : null}

        {tab === 'system' ? (
          <>
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="mb-3 text-sm font-medium">{t('settings.serverConfig')}</p>
              <div className="flex flex-wrap gap-2">
                <ConfigBadge
                  ok={Boolean(health?.relayConfigured)}
                  label={`${t('settings.relayProvider')} ${health?.relayLabel ?? ''}`.trim()}
                />
                <ConfigBadge ok={Boolean(health?.driveConfigured)} label={t('settings.googleOAuth')} />
                <ConfigBadge
                  ok={Boolean(health?.googleMailConfigured)}
                  label={t('settings.googleMailOAuth')}
                />
                <ConfigBadge
                  ok={Boolean(health?.microsoftConfigured)}
                  label={t('settings.microsoftOAuth')}
                />
                <ConfigBadge ok={Boolean(health?.r2Configured)} label={t('settings.r2')} />
                <ConfigBadge ok={Boolean(health?.pushConfigured)} label={t('settings.push')} />
                <ConfigBadge ok={Boolean(health?.cronConfigured)} label={t('settings.cron')} />
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-muted hover:text-slate-800"
            >
              <LogOut size={16} /> {t('common.logout')}
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
