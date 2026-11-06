import {
  AlertCircle,
  FolderInput,
  Inbox,
  Loader2,
  Paperclip,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import type { Folder, Label, MessageSummary } from '../../shared/types'
import { useI18n } from '../i18n'
import { cn, formatDate, initials, labelStyle } from '../lib/utils'

type MessageAction = 'delete' | 'spam' | 'move'
type MoveTarget = 'inbox' | 'spam' | 'trash'

interface MailListProps {
  messages: MessageSummary[]
  labels: Label[]
  selectedId: string | null
  loading: boolean
  syncing?: boolean
  folder: Folder
  labelName?: string | null
  fullWidth?: boolean
  className?: string
  selectedIds?: string[]
  actionBusy?: boolean
  onSelect: (id: string) => void
  onToggleSelect?: (id: string) => void
  onToggleSelectAll?: (ids: string[]) => void
  onAction?: (action: MessageAction, target?: MoveTarget) => void
}

function primaryLabel(message: MessageSummary, fallback: string): string {
  if (message.folder === 'inbox' || message.folder === 'spam') {
    return message.from.name ?? message.from.email ?? fallback
  }
  const recipients = message.to.map((item) => item.name ?? item.email).join(', ')
  return recipients || fallback
}

function folderName(folder: Folder, t: (key: string) => string): string {
  return folder === 'inbox'
    ? t('list.inbox')
    : folder === 'sent'
      ? t('list.sent')
      : folder === 'spam'
        ? t('list.spam')
        : t('list.drafts')
}

export function MailList({
  messages,
  labels,
  selectedId,
  loading,
  syncing = false,
  folder,
  labelName,
  fullWidth = false,
  className,
  selectedIds = [],
  actionBusy = false,
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onAction,
}: MailListProps) {
  const { t, locale } = useI18n()
  const title = labelName ?? folderName(folder, t)
  const empty = labelName
    ? t('list.emptyLabel')
    : folder === 'inbox'
      ? t('list.emptyInbox')
      : folder === 'sent'
        ? t('list.emptySent')
        : folder === 'spam'
          ? t('list.emptySpam')
          : t('list.emptyDrafts')
  const emptyHint = labelName
    ? t('list.emptyLabelHint')
    : folder === 'inbox'
      ? t('list.emptyInboxHint')
      : folder === 'sent'
        ? t('list.emptySentHint')
        : folder === 'spam'
          ? t('list.emptySpamHint')
          : t('list.emptyDraftsHint')
  const fallback = t('list.noRecipients')
  const selectedSet = new Set(selectedIds)
  const allIds = messages.map((message) => message.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id))
  const someSelected = allIds.some((id) => selectedSet.has(id))
  const selectedCount = selectedIds.length
  const canSelect = Boolean(onToggleSelect && onToggleSelectAll)

  return (
    <section
      className={cn(
        'flex w-full shrink-0 flex-col overflow-hidden rounded-tl-2xl border-t border-l border-line bg-white',
        !fullWidth && 'md:w-[380px] xl:w-[430px]',
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-sm">
        {selectedCount > 0 && canSelect ? (
          <>
            <button
              type="button"
              onClick={() => onToggleSelectAll?.([])}
              className="rounded p-1 text-muted hover:bg-slate-100"
              aria-label={t('list.clearSelection')}
              title={t('list.clearSelection')}
            >
              <X size={16} />
            </button>
            <span className="text-xs font-medium">{t('list.selected', { count: selectedCount })}</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => onAction?.('delete')}
                className="rounded p-1.5 text-muted hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                aria-label={t('list.delete')}
                title={t('list.delete')}
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => onAction?.('spam')}
                className="rounded p-1.5 text-muted hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                aria-label={t('list.spamAction')}
                title={t('list.spamAction')}
              >
                <ShieldAlert size={16} />
              </button>
              <label className="flex items-center gap-1 rounded px-1.5 py-1 text-muted hover:bg-slate-100">
                <FolderInput size={15} />
                <select
                  value=""
                  disabled={actionBusy}
                  onChange={(event) => {
                    const target = event.target.value as MoveTarget
                    if (target) {
                      onAction?.('move', target)
                    }
                    event.target.value = ''
                  }}
                  aria-label={t('list.moveTo')}
                  className="max-w-28 bg-transparent text-xs outline-none"
                >
                  <option value="">{t('list.moveTo')}</option>
                  <option value="inbox">{t('list.moveInbox')}</option>
                  <option value="spam">{t('list.moveSpam')}</option>
                  <option value="trash">{t('list.moveTrash')}</option>
                </select>
              </label>
            </div>
          </>
        ) : (
          <>
            {canSelect ? (
              <input
                type="checkbox"
                checked={allSelected}
                ref={(element) => {
                  if (element) {
                    element.indeterminate = someSelected && !allSelected
                  }
                }}
                onChange={() => onToggleSelectAll?.(allIds)}
                aria-label={t('list.selected', { count: messages.length })}
                className="h-3.5 w-3.5 shrink-0"
              />
            ) : null}
            <span className="truncate font-medium">{title}</span>
            <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">
              {syncing ? (
                <span className="flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  {t('list.syncing')}
                </span>
              ) : null}
              <span>{messages.length}</span>
            </span>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">
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
            {folder === 'spam' ? (
              <ShieldAlert size={40} className="text-slate-300" />
            ) : (
              <Inbox size={40} className="text-slate-300" />
            )}
            <p className="text-sm">{empty}</p>
            <p className="text-xs">{emptyHint}</p>
          </div>
        ) : (
          messages.map((message) => {
            const label = primaryLabel(message, fallback)
            const messageLabels = message.labelIds
              .map((id) => labels.find((item) => item.id === id))
              .filter((item): item is Label => Boolean(item))
            const checked = selectedSet.has(message.id)
            return (
              <div
                role="button"
                tabIndex={0}
                key={message.id}
                onClick={() => onSelect(message.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) {
                    return
                  }
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(message.id)
                  }
                }}
                className={cn(
                  'grid w-full cursor-pointer grid-cols-[auto_auto_1fr_auto] items-start gap-2 border-b border-line/80 px-3 py-2.5 text-left transition sm:gap-3 sm:px-4',
                  checked
                    ? 'bg-brand-soft/70'
                    : selectedId === message.id
                      ? 'bg-blue-50'
                      : message.unread
                        ? 'bg-white'
                        : 'bg-slate-50/60',
                  'hover:bg-slate-100 focus:bg-slate-100 focus:outline-none',
                )}
              >
                <span
                  className="mt-2 flex items-center"
                  onClick={(event) => event.stopPropagation()}
                >
                  {canSelect ? (
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleSelect?.(message.id)}
                      aria-label={message.subject || t('list.noSubject')}
                      className="h-3.5 w-3.5"
                    />
                  ) : null}
                </span>
                <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                  {initials(label)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {message.unread ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                    ) : null}
                    <p
                      className={cn(
                        'truncate text-sm',
                        message.unread ? 'font-semibold' : 'font-medium',
                      )}
                    >
                      {message.folder === 'inbox' || message.folder === 'spam'
                        ? label
                        : t('list.to', { value: label })}
                    </p>
                    {labelName ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {folderName(message.folder, t)}
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
                    {message.snippet ? (
                      <span className="text-muted"> — {message.snippet}</span>
                    ) : null}
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
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
