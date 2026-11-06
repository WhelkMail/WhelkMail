import { AlertCircle, Inbox, Paperclip } from 'lucide-react'
import type { Folder, Label, MessageSummary } from '../../shared/types'
import { useI18n } from '../i18n'
import { cn, formatDate, initials, labelStyle } from '../lib/utils'

interface MailListProps {
  messages: MessageSummary[]
  labels: Label[]
  selectedId: string | null
  loading: boolean
  folder: Folder
  labelName?: string | null
  fullWidth?: boolean
  className?: string
  onSelect: (id: string) => void
}

function primaryLabel(message: MessageSummary, fallback: string): string {
  if (message.folder === 'inbox') {
    return message.from.name ?? message.from.email ?? fallback
  }
  const recipients = message.to.map((item) => item.name ?? item.email).join(', ')
  return recipients || fallback
}

export function MailList({
  messages,
  labels,
  selectedId,
  loading,
  folder,
  labelName,
  fullWidth = false,
  className,
  onSelect,
}: MailListProps) {
  const { t, locale } = useI18n()
  const folderTitle =
    folder === 'inbox' ? t('list.inbox') : folder === 'sent' ? t('list.sent') : t('list.drafts')
  const title = labelName ?? folderTitle
  const empty = labelName
    ? t('list.emptyLabel')
    : folder === 'inbox'
      ? t('list.emptyInbox')
      : folder === 'sent'
        ? t('list.emptySent')
        : t('list.emptyDrafts')
  const emptyHint = labelName
    ? t('list.emptyLabelHint')
    : folder === 'inbox'
      ? t('list.emptyInboxHint')
      : folder === 'sent'
        ? t('list.emptySentHint')
        : t('list.emptyDraftsHint')
  const fallback = t('list.noRecipients')

  return (
    <section
      className={cn(
        'flex w-full shrink-0 flex-col overflow-hidden rounded-tl-2xl border-t border-l border-line bg-white',
        !fullWidth && 'max-w-2xl',
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted">{messages.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="animate-pulse space-y-2">
                <div className="h-3 w-1/3 rounded bg-slate-200" />
                <div className="h-3 w-3/4 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
            <Inbox size={40} className="text-slate-300" />
            <p className="text-sm">{empty}</p>
            <p className="text-xs">{emptyHint}</p>
          </div>
        ) : (
          messages.map((message) => {
            const label = primaryLabel(message, fallback)
            const messageLabels = message.labelIds
              .map((id) => labels.find((item) => item.id === id))
              .filter((item): item is Label => Boolean(item))
            return (
              <button
                type="button"
                key={message.id}
                onClick={() => onSelect(message.id)}
                className={cn(
                  'grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-line/80 px-4 py-2.5 text-left transition',
                  selectedId === message.id ? 'bg-blue-50' : message.unread ? 'bg-white' : 'bg-slate-50/60',
                  'hover:bg-slate-100',
                )}
              >
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                  {initials(label)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {message.unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-brand" /> : null}
                    <p className={cn('truncate text-sm', message.unread ? 'font-semibold' : 'font-medium')}>
                      {message.folder === 'inbox' ? label : t('list.to', { value: label })}
                    </p>
                    {labelName ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {message.folder === 'inbox'
                          ? t('list.inbox')
                          : message.folder === 'sent'
                            ? t('list.sent')
                            : t('list.drafts')}
                      </span>
                    ) : null}
                    {message.status === 'failed' ? (
                      <span className="flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-strong">
                        <AlertCircle size={11} /> {t('list.notSent')}
                      </span>
                    ) : null}
                    {message.status === 'draft' ? (
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        {t('list.draft')}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-sm">
                    <span className={cn('text-slate-700', message.unread && 'font-medium')}>
                      {message.subject || t('list.noSubject')}
                    </span>
                    {messageLabels.slice(0, 2).map((item) => (
                      <span
                        key={item.id}
                        className={cn(
                          'ml-1.5 inline-block rounded px-1.5 py-0.5 align-middle text-[10px] font-medium',
                          labelStyle(item.color),
                        )}
                      >
                        {item.name}
                      </span>
                    ))}
                    {messageLabels.length > 2 ? (
                      <span className="ml-1 text-[10px] text-muted">
                        +{messageLabels.length - 2}
                      </span>
                    ) : null}
                    {message.snippet ? <span className="text-muted"> — {message.snippet}</span> : null}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 text-[11px] text-muted">
                  <span>{formatDate(message.date, locale)}</span>
                  {message.hasAttachments ? (
                    <span className="flex items-center gap-0.5">
                      <Paperclip size={12} />
                    </span>
                  ) : null}
                </div>
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}
