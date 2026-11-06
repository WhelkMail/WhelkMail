import { useEffect, useState } from 'react'
import { Copy, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import type { TotpSetup, TwoFactorStatus } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { cn } from '../lib/utils'

export function TwoFactorSettings() {
  const { t } = useI18n()
  const [status, setStatus] = useState<TwoFactorStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [setup, setSetup] = useState<TotpSetup | null>(null)
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [password, setPassword] = useState('')
  const [disableCode, setDisableCode] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .totpStatus()
      .then((value) => {
        if (!cancelled) {
          setStatus(value)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorText(reason, t))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [t])

  async function startSetup() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      setSetup(await api.totpSetup())
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setBusy(false)
    }
  }

  async function enable() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.totpEnable(code)
      setRecoveryCodes(result.recoveryCodes)
      setSetup(null)
      setCode('')
      setStatus({ enabled: true, recoveryRemaining: result.recoveryCodes.length })
      setNotice(t('security.enabledToast'))
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.totpDisable(password, disableCode)
      setPassword('')
      setDisableCode('')
      setRecoveryCodes([])
      setStatus({ enabled: false, recoveryRemaining: 0 })
      setNotice(t('security.disabledToast'))
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setBusy(false)
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setNotice(t('security.copied'))
    } catch {
      setError(t('security.copyFailed'))
    }
  }

  if (loading) {
    return <p className="text-xs text-muted">{t('common.loading')}</p>
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {status?.enabled ? <ShieldCheck size={15} className="text-emerald-600" /> : <ShieldOff size={15} className="text-muted" />}
            {t('security.title')}
          </p>
          <p className="mt-1 max-w-lg text-[11px] text-muted">{t('security.hint')}</p>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px]',
            status?.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-muted',
          )}
        >
          {status?.enabled ? t('security.enabled') : t('security.disabled')}
        </span>
      </div>

      {error ? <p className="mt-3 text-[11px] text-brand-strong">{error}</p> : null}
      {notice ? <p className="mt-3 text-[11px] text-emerald-700">{notice}</p> : null}

      {!status?.enabled ? (
        <div className="mt-4">
          <p className="text-[11px] text-muted">{t('security.appsHint')}</p>
          <p className="mt-0.5 text-[11px] text-slate-700">{t('security.apps')}</p>

          {!setup ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startSetup()}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-strong disabled:opacity-50"
            >
              <KeyRound size={14} /> {t('security.enable')}
            </button>
          ) : (
            <div className="mt-3 space-y-3 rounded-xl bg-slate-50 p-3">
              <p className="text-[11px] text-muted">{t('security.setupHint')}</p>

              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {t('security.secret')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-white px-2 py-1.5 font-mono text-[11px]">
                    {setup.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy(setup.secret)}
                    title={t('security.copy')}
                    className="rounded-lg border border-line bg-white p-1.5 text-muted hover:text-slate-700"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {t('security.uri')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-white px-2 py-1.5 font-mono text-[10px]">
                    {setup.otpauth}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy(setup.otpauth)}
                    title={t('security.copy')}
                    className="rounded-lg border border-line bg-white p-1.5 text-muted hover:text-slate-700"
                  >
                    <Copy size={13} />
                  </button>
                </div>
              </div>

              <label className="block text-xs">
                <span className="mb-1 block font-medium text-muted">{t('security.code')}</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-center font-mono text-base tracking-widest outline-none focus:border-brand"
                />
              </label>
              <button
                type="button"
                disabled={busy || !code.trim()}
                onClick={() => void enable()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {t('security.confirm')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-[11px] text-muted">{t('security.enabledHint')}</p>
          <p className="text-[11px] text-slate-700">
            {t('security.recoveryRemaining', { count: status.recoveryRemaining })}
          </p>

          {recoveryCodes.length > 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] font-medium text-amber-900">{t('security.recoveryCodes')}</p>
              <p className="mt-0.5 text-[11px] text-amber-800">{t('security.recoveryWarning')}</p>
              <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[11px] text-amber-900">
                {recoveryCodes.map((item) => (
                  <code key={item}>{item}</code>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRecoveryCodes([])}
                className="mt-2 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] text-amber-900 hover:bg-amber-100"
              >
                {t('security.recoverySaved')}
              </button>
            </div>
          ) : null}

          <div className="rounded-xl bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-700">{t('security.disable')}</p>
            <p className="mt-0.5 text-[11px] text-muted">{t('security.disableHint')}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('security.password')}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
              <input
                value={disableCode}
                onChange={(event) => setDisableCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode="text"
                placeholder={t('security.code')}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
            </div>
            <button
              type="button"
              disabled={busy || !password || !disableCode.trim()}
              onClick={() => void disable()}
              className="mt-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs text-brand-strong hover:bg-red-50 disabled:opacity-50"
            >
              {t('security.disableConfirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
