import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Trash2 } from 'lucide-react'
import type { StorageCleanupEntry } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { formatDate } from '../lib/utils'

/**
 * Objects that survived an account deletion. They stay on Drive/R2 (the account
 * and its credentials are gone), so the panel exists to make them traceable.
 */
export function StorageCleanupPanel() {
  const { t, locale } = useI18n()
  const [entries, setEntries] = useState<StorageCleanupEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await api.storageCleanup()
      setEntries(response.entries)
    } catch (reason) {
      setError(errorText(reason, t))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function clear() {
    if (!window.confirm(t('settings.cleanupLogClearConfirm'))) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.clearStorageCleanup()
      setEntries([])
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t('settings.cleanupLog')}</p>
          <p className="mt-1 text-[11px] text-muted">{t('settings.cleanupLogHint')}</p>
        </div>
        {entries.length > 0 ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clear()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:border-red-200 hover:text-brand-strong disabled:opacity-50"
          >
            <Trash2 size={13} /> {t('settings.cleanupLogClear')}
          </button>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-xs text-brand-strong">{error}</p> : null}

      {entries.length === 0 ? (
        <p className="mt-3 text-xs text-muted">{t('settings.cleanupLogEmpty')}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px]">
              <p className="flex items-center gap-1.5 font-medium text-slate-700">
                <AlertCircle size={12} className="text-amber-600" />
                {entry.accountEmail} · {entry.driver}
              </p>
              <p className="mt-0.5 break-all text-muted">{entry.key}</p>
              <p className="mt-0.5 text-muted">
                {formatDate(entry.createdAt, locale)}
                {entry.error ? ` · ${entry.error}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
