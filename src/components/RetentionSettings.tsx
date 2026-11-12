import { useCallback, useEffect, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import type { RetentionSummary } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'

interface RetentionSettingsProps {
  /** 0 means "keep everything"; the panel stays hidden until something pruned. */
  days: number
}

function formatDate(value: string | null, locale: string): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString(locale === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export function RetentionSettings({ days }: RetentionSettingsProps) {
  const { t, locale } = useI18n()
  const [summary, setSummary] = useState<RetentionSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await api.retention()
      setSummary(response.retention)
    } catch {
      // The panel is informational: a failed read must not break Settings.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, days])

  async function restore() {
    if (!window.confirm(t('settings.retentionRestoreConfirm'))) {
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const response = await api.resetRetentionMirror()
      setSummary(response.retention)
      setNotice(t('settings.retentionRestoreDone', { accounts: response.accounts }))
    } catch (error) {
      setNotice(errorText(error, t))
    } finally {
      setBusy(false)
    }
  }

  if (days <= 0 && !summary?.deletedTotal) {
    return null
  }

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-medium text-slate-700">
        <Database size={13} /> {t('settings.retentionMirror')}
      </p>
      <p className="mt-1 text-[11px] text-muted">
        {summary?.lastRunAt
          ? t('settings.retentionLastRun', {
              date: formatDate(summary.lastRunAt, locale),
              count: summary.lastDeleted,
            })
          : t('settings.retentionNeverRun')}
      </p>
      {summary && summary.deletedTotal > 0 ? (
        <p className="mt-1 text-[11px] text-muted">
          {t('settings.retentionDeletedTotal', { count: summary.deletedTotal })}
        </p>
      ) : null}
      {days > 0 ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          {t('settings.retentionWarning')}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted">{t('settings.retentionRestoreHint')}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void restore()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs hover:bg-slate-100 disabled:opacity-50"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} />
          {t('settings.retentionRestore')}
        </button>
      </div>
      {notice ? <p className="mt-2 text-[11px] text-slate-700">{notice}</p> : null}
    </div>
  )
}
