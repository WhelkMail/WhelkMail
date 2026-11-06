import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Trash2 } from 'lucide-react'
import type { Account, AccountPatch, DeletionLog } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { cn, formatDate } from '../lib/utils'

interface DeletionPanelProps {
  account: Account
  busy: boolean
  onUpdate: (id: string, patch: AccountPatch) => Promise<void>
}

export function DeletionPanel({ account, busy, onUpdate }: DeletionPanelProps) {
  const { t, locale } = useI18n()
  const [logs, setLogs] = useState<DeletionLog[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .deletionLogs(account.id)
      .then((response) => {
        if (!cancelled) {
          setLogs(response.logs)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorText(reason, t))
        }
      })
    return () => {
      cancelled = true
    }
  }, [account.id, t])

  async function toggle(enabled: boolean) {
    if (enabled && !window.confirm(t('deletion.confirm'))) {
      return
    }
    setError(null)
    try {
      await onUpdate(account.id, { deleteAfterArchive: enabled })
      const response = await api.deletionLogs(account.id)
      setLogs(response.logs)
    } catch (reason) {
      setError(errorText(reason, t))
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line p-3">
      <label className="flex cursor-pointer items-start gap-2 text-xs">
        <input
          type="checkbox"
          checked={account.deleteAfterArchive}
          disabled={busy || !account.archiveImapBodies}
          onChange={(event) => void toggle(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5"
        />
        <span>
          <span className="flex items-center gap-1.5 font-medium text-slate-700">
            <Trash2 size={13} /> {t('deletion.title')}
          </span>
          <span className="text-muted">
            {account.archiveImapBodies ? t('deletion.hint') : t('deletion.requiresArchive')}
          </span>
        </span>
      </label>

      {logs.length > 0 ? (
        <div className="mt-3 space-y-1">
          {logs.slice(0, 3).map((log) => (
            <div
              key={log.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px]"
            >
              <span className="truncate text-muted">{log.messageId}</span>
              <span
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-0.5',
                  log.status === 'done'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-brand-strong',
                )}
              >
                {log.status === 'done' ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                {log.status}
              </span>
              <span className="text-[10px] text-muted">
                {formatDate(log.createdAt, locale)}
              </span>
              {log.error ? (
                <span className="w-full text-[10px] text-brand-strong">{log.error}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[11px] text-brand-strong">{error}</p> : null}
    </div>
  )
}
