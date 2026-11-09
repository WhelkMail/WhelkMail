import type { FormEvent } from 'react'
import { useState } from 'react'
import { AlertCircle, Cloud, HardDrive, Send, Server } from 'lucide-react'
import { MAIL_PRESETS, RELAY_PROVIDERS, findPreset, findRelayProvider } from '../../shared/presets'
import type {
  Account,
  AccountCreateInput,
  HealthStatus,
  MailSecurity,
  StorageDriver,
  StorageOptions,
} from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { LocaleToggle } from './LocaleToggle'
import { WhelkLogo } from './WhelkLogo'

interface OnboardingProps {
  storage: StorageOptions
  health: HealthStatus | null
  busy: boolean
  error: string | null
  onCancel?: () => void
  onCreate: (input: AccountCreateInput) => Promise<Account | null>
}

const DEFAULT_PRESET = 'gmail'

export function Onboarding({ storage, health, busy, error, onCancel, onCreate }: OnboardingProps) {
  const { t } = useI18n()
  const initial = findPreset(DEFAULT_PRESET) ?? MAIL_PRESETS[0]
  const [mode, setMode] = useState<'imap' | 'relay'>('imap')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [incomingLabelName, setIncomingLabelName] = useState('')
  const [presetId, setPresetId] = useState(initial.id)
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState(initial.imapHost)
  const [imapPort, setImapPort] = useState(String(initial.imapPort))
  const [imapSecurity, setImapSecurity] = useState<MailSecurity>(initial.imapSecurity)
  const [smtpHost, setSmtpHost] = useState(initial.smtpHost)
  const [smtpPort, setSmtpPort] = useState(String(initial.smtpPort))
  const [smtpSecurity, setSmtpSecurity] = useState<MailSecurity>(initial.smtpSecurity)
  const [autoSavesSent, setAutoSavesSent] = useState(initial.autoSavesSent)
  const [gmailOAuth, setGmailOAuth] = useState(health?.googleMailConfigured ?? false)
  const [relayStorage, setRelayStorage] = useState<StorageDriver>('drive')
  const [relayProvider, setRelayProvider] = useState('smtp2go')
  const [relayApiKey, setRelayApiKey] = useState('')
  const [relayApiSecret, setRelayApiSecret] = useState('')
  const [relayDomain, setRelayDomain] = useState('')
  const [relayRegion, setRelayRegion] = useState('us')
  const [relaySmtpHost, setRelaySmtpHost] = useState('')
  const [relaySmtpPort, setRelaySmtpPort] = useState('465')
  const [relaySmtpSecurity, setRelaySmtpSecurity] = useState<MailSecurity>('tls')
  const [relayUsername, setRelayUsername] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const preset = findPreset(presetId) ?? initial
  const relayMeta = findRelayProvider(relayProvider)
  const oauthProvider =
    mode === 'imap'
      ? presetId === 'gmail'
        ? gmailOAuth
          ? 'google'
          : undefined
        : preset.oauthProvider
      : undefined
  const oauth = mode === 'imap' && Boolean(oauthProvider)
  const googleReady = health?.googleMailConfigured ?? false
  const microsoftReady = health?.microsoftConfigured ?? false
  const oauthReady =
    oauthProvider === 'google' ? googleReady : oauthProvider === 'microsoft' ? microsoftReady : false


  function applyPreset(id: string) {
    const next = findPreset(id)
    if (!next) {
      return
    }
    setPresetId(id)
    setImapHost(next.imapHost)
    setImapPort(String(next.imapPort))
    setImapSecurity(next.imapSecurity)
    setSmtpHost(next.smtpHost)
    setSmtpPort(String(next.smtpPort))
    setSmtpSecurity(next.smtpSecurity)
    setAutoSavesSent(next.autoSavesSent)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLocalError(null)
    if (mode === 'imap') {
      if (!imapHost || !smtpHost) {
        setLocalError(t('onboarding.hostsRequired'))
        return
      }
      if (!oauth && !password) {
        setLocalError(t('onboarding.passwordRequired'))
        return
      }
      if (oauth && !oauthReady) {
        setLocalError(t('onboarding.oauthNotConfigured'))
        return
      }
      const account = await onCreate({
        kind: 'imap',
        email,
        displayName,
        preset: presetId,
        imapHost,
        imapPort: Number(imapPort),
        imapSecurity,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpSecurity,
        username: username.trim() || undefined,
        authType: oauth ? 'oauth2' : 'password',
        oauthProvider: oauth ? oauthProvider : undefined,
        password: oauth ? undefined : password,
        autoSavesSent,
        incomingLabelName: incomingLabelName.trim() || undefined,
      })
      if (account && oauth) {
        window.location.href =
          oauthProvider === 'google'
            ? api.googleConnectUrl(account.id)
            : api.microsoftConnectUrl(account.id)
      }
      return
    }

    if (relayMeta?.manual && (!relaySmtpHost.trim() || !relaySmtpPort.trim())) {
      setLocalError(t('onboarding.hostsRequired'))
      return
    }
    if (!relayApiKey && !relayMeta?.manual) {
      setLocalError(t('onboarding.relayKeyRequired'))
      return
    }
    if (relayMeta?.needsSecret && !relayApiSecret) {
      setLocalError(t('onboarding.relaySecretRequired'))
      return
    }
    if (relayMeta?.needsDomain && !relayDomain) {
      setLocalError(t('onboarding.relayDomainRequired'))
      return
    }
    await onCreate({
      kind: 'relay',
      email,
      displayName,
      storageDriver: relayStorage === 'r2' ? 'r2' : 'drive',
      relayProvider,
      relayApiKey: relayApiKey || undefined,
      relayApiSecret: relayApiSecret || undefined,
      relayDomain: relayDomain || undefined,
      relayRegion: relayRegion === 'eu' ? 'eu' : 'us',
      smtpHost: relayMeta?.manual ? relaySmtpHost.trim() || undefined : undefined,
      smtpPort: relayMeta?.manual ? Number(relaySmtpPort) : undefined,
      smtpSecurity: relayMeta?.manual ? relaySmtpSecurity : undefined,
      username: relayMeta?.manual ? relayUsername.trim() || email : undefined,
      incomingLabelName: incomingLabelName.trim() || undefined,
    })
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div className="mb-4 flex w-full max-w-2xl justify-end">
        <LocaleToggle />
      </div>
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
            <WhelkLogo size={24} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t('onboarding.title')}</h1>
            <p className="text-sm text-muted">{t('onboarding.subtitle')}</p>
          </div>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="ml-auto rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-slate-50"
            >
              {t('onboarding.cancel')}
            </button>
          ) : null}
        </div>

        <form onSubmit={submit} className="space-y-6 rounded-2xl border border-line bg-white p-6 shadow-sm">
          <div className="flex gap-2 rounded-xl bg-slate-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode('imap')}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2',
                mode === 'imap' ? 'bg-white font-medium shadow-sm' : 'text-muted',
              )}
            >
              <Server size={15} /> {t('onboarding.imapTab')}
            </button>
            <button
              type="button"
              onClick={() => setMode('relay')}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2',
                mode === 'relay' ? 'bg-white font-medium shadow-sm' : 'text-muted',
              )}
            >
              <Send size={15} /> {t('onboarding.relayTab')}
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-muted">{t('onboarding.displayName')}</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                maxLength={120}
                placeholder="Mario Rossi"
                className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-muted">{t('onboarding.email')}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="mario@dominio.it"
                className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-muted">
              {t('onboarding.incomingLabel')}
            </span>
            <input
              value={incomingLabelName}
              onChange={(event) => setIncomingLabelName(event.target.value)}
              placeholder={t('onboarding.incomingLabelPlaceholder')}
              maxLength={40}
              className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
            />
            <span className="mt-1 block text-[11px] text-muted">
              {t('onboarding.incomingLabelHint')}
            </span>
          </label>

          {mode === 'imap' ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block font-medium text-muted">{t('onboarding.username')}</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={email || 'nomeutente'}
                  autoComplete="username"
                  className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                />
                <span className="mt-1 block text-[11px] text-muted">
                  {t('onboarding.usernameHint')}
                </span>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium text-muted">{t('onboarding.provider')}</span>
                <select
                  value={presetId}
                  onChange={(event) => applyPreset(event.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                >
                  {MAIL_PRESETS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">{preset.note}</p>

              {presetId === 'gmail' ? (
                <div>
                  <p className="mb-2 text-sm font-medium text-muted">{t('onboarding.authMethod')}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!googleReady}
                      onClick={() => setGmailOAuth(true)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-xs',
                        gmailOAuth
                          ? 'border-brand bg-brand-soft text-brand-strong'
                          : 'border-line hover:border-slate-300',
                        !googleReady && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      {t('onboarding.googleOAuth')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGmailOAuth(false)}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-xs',
                        !gmailOAuth
                          ? 'border-brand bg-brand-soft text-brand-strong'
                          : 'border-line hover:border-slate-300',
                      )}
                    >
                      {t('onboarding.appPassword')}
                    </button>
                  </div>
                </div>
              ) : null}

              {oauth ? (
                <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  {oauthProvider === 'google'
                    ? t('onboarding.googleOAuthNote')
                    : t('onboarding.oauthNote')}
                </p>
              ) : (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-muted">{t('onboarding.password')}</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                  />
                </label>
              )}

              <details className="rounded-xl border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">
                  {t('onboarding.advanced')}
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted">IMAP</p>
                    <input
                      value={imapHost}
                      onChange={(event) => setImapHost(event.target.value)}
                      placeholder="imap.esempio.it"
                      className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                    <div className="flex gap-2">
                      <input
                        value={imapPort}
                        onChange={(event) => setImapPort(event.target.value)}
                        inputMode="numeric"
                        className="w-24 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
                      />
                      <select
                        value={imapSecurity}
                        onChange={(event) => setImapSecurity(event.target.value as MailSecurity)}
                        className="flex-1 rounded-lg border border-line px-2 py-2 text-sm outline-none"
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
                      className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                    <div className="flex gap-2">
                      <input
                        value={smtpPort}
                        onChange={(event) => setSmtpPort(event.target.value)}
                        inputMode="numeric"
                        className="w-24 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
                      />
                      <select
                        value={smtpSecurity}
                        onChange={(event) => setSmtpSecurity(event.target.value as MailSecurity)}
                        className="flex-1 rounded-lg border border-line px-2 py-2 text-sm outline-none"
                      >
                        <option value="tls">TLS (465)</option>
                        <option value="starttls">STARTTLS (587)</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-muted">{t('settings.sentCopy')}</p>
                  <label className="flex items-start gap-2 text-xs text-slate-700">
                    <input
                      type="radio"
                      name="onboarding-sent-mode"
                      checked={autoSavesSent}
                      onChange={() => setAutoSavesSent(true)}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span>{t('settings.sentProvider')}</span>
                  </label>
                  <label className="mt-1 flex items-start gap-2 text-xs text-slate-700">
                    <input
                      type="radio"
                      name="onboarding-sent-mode"
                      checked={!autoSavesSent}
                      onChange={() => setAutoSavesSent(false)}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span>{t('settings.sentClient')}</span>
                  </label>
                  <p className="mt-2 text-[11px] text-muted">{t('settings.sentHint')}</p>
                </div>
              </details>

              {oauth && oauthProvider === 'microsoft' && !microsoftReady ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t('onboarding.microsoftMissing')}
                </p>
              ) : null}
              {oauth && oauthProvider === 'google' && !googleReady ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {t('onboarding.googleMissing')}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-muted">{t('onboarding.relayProvider')}</span>
                  <select
                    value={relayProvider}
                    onChange={(event) => setRelayProvider(event.target.value)}
                    className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                  >
                    {RELAY_PROVIDERS.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium text-muted">
                    {relayMeta?.manual ? t('onboarding.relayPassword') : t('onboarding.relayApiKey')}
                  </span>
                  <input
                    type="password"
                    value={relayApiKey}
                    onChange={(event) => setRelayApiKey(event.target.value)}
                    className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                  />
                </label>
                {relayMeta?.manual ? (
                  <>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-muted">
                        {t('onboarding.smtpHost')}
                      </span>
                      <input
                        value={relaySmtpHost}
                        onChange={(event) => setRelaySmtpHost(event.target.value)}
                        placeholder="smtp.esempio.it"
                        className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                      />
                    </label>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-muted">
                          {t('onboarding.smtpPort')}
                        </span>
                        <input
                          value={relaySmtpPort}
                          onChange={(event) => setRelaySmtpPort(event.target.value)}
                          inputMode="numeric"
                          className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block font-medium text-muted">
                          {t('onboarding.smtpSecurity')}
                        </span>
                        <select
                          value={relaySmtpSecurity}
                          onChange={(event) =>
                            setRelaySmtpSecurity(event.target.value as MailSecurity)
                          }
                          className="rounded-lg border border-line px-3 py-2 outline-none"
                        >
                          <option value="tls">TLS</option>
                          <option value="starttls">STARTTLS</option>
                        </select>
                      </label>
                    </div>
                    <label className="block text-sm sm:col-span-2">
                      <span className="mb-1 block font-medium text-muted">
                        {t('onboarding.relayUsername')}
                      </span>
                      <input
                        value={relayUsername}
                        onChange={(event) => setRelayUsername(event.target.value)}
                        placeholder={email || 'nomeutente'}
                        className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                      />
                    </label>
                  </>
                ) : null}
                {relayMeta?.needsSecret ? (
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium text-muted">{t('onboarding.relayApiSecret')}</span>
                    <input
                      type="password"
                      value={relayApiSecret}
                      onChange={(event) => setRelayApiSecret(event.target.value)}
                      className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                    />
                  </label>
                ) : null}
                {relayMeta?.needsDomain ? (
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-muted">{t('onboarding.relayDomain')}</span>
                      <input
                        value={relayDomain}
                        onChange={(event) => setRelayDomain(event.target.value)}
                        className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-brand"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block font-medium text-muted">{t('onboarding.relayRegion')}</span>
                      <select
                        value={relayRegion}
                        onChange={(event) => setRelayRegion(event.target.value)}
                        className="rounded-lg border border-line px-3 py-2 outline-none"
                      >
                        <option value="us">US</option>
                        <option value="eu">EU</option>
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-muted">{t('onboarding.storage')}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setRelayStorage('drive')}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-4 text-left transition',
                      relayStorage === 'drive' ? 'border-brand bg-brand-soft' : 'border-line hover:border-slate-300',
                    )}
                  >
                    <Cloud size={18} className="mt-0.5 text-brand" />
                    <span>
                      <span className="block text-sm font-medium">{t('settings.drive')}</span>
                      <span className="block text-xs text-muted">{t('onboarding.driveNote')}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={!storage.r2}
                    onClick={() => setRelayStorage('r2')}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-4 text-left transition',
                      relayStorage === 'r2' ? 'border-brand bg-brand-soft' : 'border-line',
                      !storage.r2 && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <HardDrive size={18} className="mt-0.5 text-brand" />
                    <span>
                      <span className="block text-sm font-medium">{t('settings.r2')}</span>
                      <span className="block text-xs text-muted">
                        {storage.r2 ? t('onboarding.r2Note') : t('onboarding.r2Unavailable')}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </>
          )}

          {localError ? (
            <p className="flex items-center gap-2 text-sm text-brand-strong">
              <AlertCircle size={14} /> {localError}
            </p>
          ) : null}
          {error ? <p className="text-sm text-brand-strong">{error}</p> : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              {mode === 'imap' ? t('onboarding.imapHint') : t('onboarding.relayHint')}
            </p>
            <button
              type="submit"
              disabled={busy || (oauth && !oauthReady)}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {busy ? t('onboarding.creating') : t('onboarding.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
