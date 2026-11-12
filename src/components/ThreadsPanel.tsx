import { useCallback, useEffect, useState } from 'react'
import { Layers } from 'lucide-react'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'

interface Pending {
  accountId: string
  email: string
  pending: number
  messages: number
  threads: number
}

/**
 * Mail mirrored before conversations existed has no thread key yet, so it is
 * listed one row per message. The sync fills it a few messages per run; this card
 * does it in bulk (headers only) for a mailbox with a long history.
 */
interface InboxCheck {
  conversations: number
  messages: number
  error: string | null
}

export function ThreadsPanel() {
  const { t } = useI18n()
  const [pending, setPending] = useState<Pending[]>([])
  const [checks, setChecks] = useState<Record<string, InboxCheck>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await api.threadsPending()
      setPending(response.accounts)
      // Ask the deployed endpoint what it actually returns for the Inbox: this is
      // the same call the list makes, so a mismatch here explains a flat list.
      const results: Record<string, InboxCheck> = {}
      for (const account of response.accounts) {
        try {
          const threads = await api.threads({
            accountId: account.accountId,
            folder: 'inbox',
            limit: 100,
          })
          results[account.accountId] = {
            conversations: threads.threads.length,
            messages: threads.threads.reduce((total, thread) => total + thread.total, 0),
            error: threads.errors[0]?.message ?? null,
          }
        } catch (reason) {
          results[account.accountId] = {
            conversations: 0,
            messages: 0,
            error: errorText(reason, t),
          }
        }
      }
      setChecks(results)
    } catch (reason) {
      setError(errorText(reason, t))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function rebuild(accountId: string) {
    setBusy(accountId)
    setError(null)
    setNotice(null)
    try {
      const response = await api.rebuildThreads(accountId)
      setNotice(t('settings.threadsRebuilt', { updated: response.updated, pending: response.pending }))
      await load()
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-line bg-white p-5">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Layers size={15} /> {t('settings.threads')}
      </p>
      <p className="mt-1 text-[11px] text-muted">{t('settings.threadsHint')}</p>

      {error ? <p className="mt-2 text-xs text-brand-strong">{error}</p> : null}
      {notice ? <p className="mt-2 text-xs text-slate-700">{notice}</p> : null}

      {pending.length === 0 ? (
        <p className="mt-3 text-xs text-muted">{t('settings.threadsNone')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {pending.map((entry) => (
            <li key={entry.accountId} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-700">{entry.email}</span>
                <span className="text-muted">
                  {t('settings.threadsStats', {
                    messages: entry.messages,
                    threads: entry.threads,
                  })}
                  {entry.pending > 0
                    ? ` · ${t('settings.threadsPending', { count: entry.pending })}`
                    : ''}
                </span>
                {checks[entry.accountId] ? (
                  <span className="block text-[11px] text-muted">
                    {checks[entry.accountId].error
                      ? `Inbox: ${checks[entry.accountId].error}`
                      : t('settings.threadsInbox', {
                          conversations: checks[entry.accountId].conversations,
                          messages: checks[entry.accountId].messages,
                        })}
                  </span>
                ) : null}
              </span>
              {entry.pending > 0 ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void rebuild(entry.accountId)}
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-50"
                >
                  {busy === entry.accountId ? t('common.loading') : t('settings.threadsRebuild')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
