import type { FormEvent } from 'react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { LocaleToggle } from './LocaleToggle'
import { WhelkLogo } from './WhelkLogo'

interface LoginProps {
  onSuccess: () => void
}

export function Login({ onSuccess }: LoginProps) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challenge, setChallenge] = useState('')
  const [step, setStep] = useState<'password' | 'totp'>('password')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submitPassword(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.login(password)
      if (result.twoFactorRequired && result.challenge) {
        setChallenge(result.challenge)
        setStep('totp')
        setCode('')
      } else {
        onSuccess()
      }
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.loginTwoFactor(challenge, code)
      onSuccess()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4">
      <div className="mb-4 flex w-full max-w-sm justify-end">
        <LocaleToggle />
      </div>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand">
            <WhelkLogo size={24} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{t('app.name')}</h1>
            <p className="text-xs text-muted">
              {step === 'totp' ? t('login.twoFactorTitle') : t('login.subtitle')}
            </p>
          </div>
        </div>

        {step === 'password' ? (
          <form onSubmit={submitPassword} className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-muted">{t('login.password')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
                required
                className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
              />
            </label>
            {error ? <p className="text-sm text-brand-strong">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {busy ? t('login.busy') : t('login.submit')}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="space-y-4">
            <p className="text-xs text-muted">{t('login.twoFactorHint')}</p>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-muted">{t('login.code')}</span>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoFocus
                required
                autoComplete="one-time-code"
                inputMode="text"
                className="w-full rounded-lg border border-line px-3 py-2 text-center font-mono text-lg tracking-widest outline-none focus:border-brand"
              />
            </label>
            <p className="text-[11px] text-muted">{t('login.recoveryHint')}</p>
            {error ? <p className="text-sm text-brand-strong">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:opacity-60"
            >
              {busy ? t('login.busy') : t('login.verify')}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('password')
                setCode('')
                setError(null)
              }}
              className="w-full rounded-lg border border-line px-4 py-2 text-sm text-muted hover:bg-slate-50"
            >
              {t('login.back')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
