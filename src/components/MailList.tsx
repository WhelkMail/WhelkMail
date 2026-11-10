import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  AlertCircle,
  ChevronDown,
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
  titleOverride?: string | null
  showFolder?: boolean
  fullWidth?: boolean
  className?: string
  selectedIds?: string[]
  actionBusy?: boolean
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
  onSelect: (id: string) => void
  onToggleSelect?: (id: string) => void
  onToggleSelectAll?: (ids: string[]) => void
  onAction?: (action: MessageAction, target?: MoveTarget) => void
  onMessageAction?: (id: string, action: MessageAction, target?: MoveTarget) => void
}

interface SwipeGesture {
  id: string
  startX: number
  startY: number
  dx: number
  dy: number
  moved: boolean
  swiping: boolean
  longPressFired: boolean
  longPressTimer: number | null
  /** Row that receives the transform; kept off React state so dragging never re-renders. */
  row: HTMLElement | null
  /** Wrapper that carries the CSS variables driving the action hints. */
  wrapper: HTMLElement | null
  frame: number | null
  pendingDx: number
}

/** Horizontal travel before the row starts following the finger. */
const SWIPE_START = 8
/** Travel that commits the action on release. */
const SWIPE_COMMIT = 60
const SWIPE_MAX = 120

function paintSwipe(gesture: SwipeGesture): void {
  gesture.frame = null
  const dx = gesture.pendingDx
  if (gesture.row) {
    gesture.row.style.transform = `translate3d(${dx}px, 0, 0)`
  }
  if (gesture.wrapper) {
    gesture.wrapper.style.setProperty(
      '--swipe-start',
      dx > 0 ? String(Math.min(1, dx / SWIPE_COMMIT)) : '0',
    )
    gesture.wrapper.style.setProperty(
      '--swipe-end',
      dx < 0 ? String(Math.min(1, -dx / SWIPE_COMMIT)) : '0',
    )
  }
}

/** Coalesce pointer moves into one paint per frame. */
function scheduleSwipe(gesture: SwipeGesture, dx: number): void {
  gesture.pendingDx = dx
  if (gesture.frame !== null) {
    return
  }
  gesture.frame = window.requestAnimationFrame(() => paintSwipe(gesture))
}

/** Animate the row off-screen (action) or back to rest (aborted swipe). */
function settleSwipe(gesture: SwipeGesture, direction: 'start' | 'end' | null): void {
  if (gesture.frame !== null) {
    window.cancelAnimationFrame(gesture.frame)
    gesture.frame = null
  }
  const row = gesture.row
  const wrapper = gesture.wrapper
  const transition = 'transform 150ms cubic-bezier(0.22, 0.61, 0.36, 1)'
  if (row) {
    row.style.transition = transition
    row.style.transform =
      direction === 'end'
        ? 'translate3d(-100%, 0, 0)'
        : direction === 'start'
          ? 'translate3d(100%, 0, 0)'
          : 'translate3d(0, 0, 0)'
  }
  if (wrapper) {
    wrapper.style.setProperty('--swipe-start', '0')
    wrapper.style.setProperty('--swipe-end', '0')
  }
  window.setTimeout(() => {
    if (!row?.isConnected) {
      return
    }
    // The list did not drop the row (action failed): slide it back in.
    row.style.transition = transition
    row.style.transform = 'translate3d(0, 0, 0)'
    window.setTimeout(() => {
      if (!row.isConnected) {
        return
      }
      row.style.transition = ''
      row.style.transform = ''
      row.style.willChange = ''
    }, 170)
  }, direction ? 400 : 170)
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return isMobile
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
  titleOverride,
  showFolder = false,
  fullWidth = false,
  className,
  selectedIds = [],
  actionBusy = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onSelect,
  onToggleSelect,
  onToggleSelectAll,
  onAction,
  onMessageAction,
}: MailListProps) {
  const { t, locale } = useI18n()
  const isMobile = useIsMobile()
  const [selectMode, setSelectMode] = useState(false)
  const gestureRef = useRef<SwipeGesture | null>(null)
  const suppressClickRef = useRef(false)
  const title = titleOverride ?? labelName ?? folderName(folder, t)
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
  const showToolbar = canSelect && (selectedCount > 0 || (isMobile && selectMode))
  const rightAction =
    folder === 'spam'
      ? ({ action: 'move', target: 'inbox' } as const)
      : folder === 'inbox'
        ? ({ action: 'spam', target: undefined } as const)
        : null

  useEffect(() => {
    setSelectMode(false)
    gestureRef.current = null
  }, [folder])

  useEffect(() => {
    if (!isMobile) {
      setSelectMode(false)
    }
  }, [isMobile])

  function clearSelection() {
    onToggleSelectAll?.([])
    setSelectMode(false)
  }

  function enterSelection(id: string) {
    if (!canSelect) {
      return
    }
    setSelectMode(true)
    if (!selectedSet.has(id)) {
      onToggleSelect?.(id)
    }
  }

  function cancelLongPress(gesture: SwipeGesture) {
    if (gesture.longPressTimer !== null) {
      window.clearTimeout(gesture.longPressTimer)
      gesture.longPressTimer = null
    }
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    message: MessageSummary,
  ) {
    if (!isMobile || selectMode || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }
    const target = event.target as HTMLElement
    if (target.closest('input, select, label, button, a')) {
      return
    }
    suppressClickRef.current = false
    if (gestureRef.current) {
      cancelLongPress(gestureRef.current)
    }
    gestureRef.current = {
      id: message.id,
      startX: event.clientX,
      startY: event.clientY,
      dx: 0,
      dy: 0,
      moved: false,
      swiping: false,
      longPressFired: false,
      row: event.currentTarget,
      wrapper: event.currentTarget.parentElement,
      frame: null,
      pendingDx: 0,
      longPressTimer: window.setTimeout(() => {
        const gesture = gestureRef.current
        if (!gesture || gesture.moved || gesture.swiping) {
          return
        }
        gesture.longPressFired = true
        gesture.longPressTimer = null
        suppressClickRef.current = true
        enterSelection(message.id)
      }, 450),
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort: the handlers still work without it.
    }
  }

  function handlePointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
    message: MessageSummary,
  ) {
    const gesture = gestureRef.current
    if (!gesture || gesture.id !== message.id) {
      return
    }
    gesture.dx = event.clientX - gesture.startX
    gesture.dy = event.clientY - gesture.startY
    if (!gesture.moved && (Math.abs(gesture.dx) > SWIPE_START || Math.abs(gesture.dy) > SWIPE_START)) {
      gesture.moved = true
      cancelLongPress(gesture)
    }
    if (gesture.longPressFired) {
      return
    }
    // Vertical intent: let the browser scroll instead of fighting the gesture.
    if (gesture.moved && Math.abs(gesture.dy) > Math.abs(gesture.dx)) {
      return
    }
    if (Math.abs(gesture.dx) <= SWIPE_START || Math.abs(gesture.dx) <= Math.abs(gesture.dy)) {
      return
    }
    if (!gesture.swiping) {
      gesture.swiping = true
      if (gesture.row) {
        gesture.row.style.transition = 'none'
        gesture.row.style.willChange = 'transform'
      }
    }
    // No setState here: a re-render of the whole list per pointer move is what
    // made the swipe trail behind the finger.
    scheduleSwipe(gesture, Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, gesture.dx)))
  }

  function handlePointerUp(message: MessageSummary) {
    const gesture = gestureRef.current
    if (!gesture || gesture.id !== message.id) {
      gestureRef.current = null
      return
    }
    gestureRef.current = null
    cancelLongPress(gesture)
    if (gesture.longPressFired) {
      suppressClickRef.current = true
      settleSwipe(gesture, null)
      return
    }
    if (!gesture.swiping) {
      if (gesture.moved) {
        suppressClickRef.current = true
      }
      return
    }
    suppressClickRef.current = true
    const commitsDelete = gesture.dx <= -SWIPE_COMMIT
    const commitsRight = !commitsDelete && gesture.dx >= SWIPE_COMMIT && Boolean(rightAction)
    if (!commitsDelete && !commitsRight) {
      settleSwipe(gesture, null)
      return
    }
    // Slide the row out first, then dispatch: the action re-fetches the list and
    // an immediate update would cut the animation off.
    settleSwipe(gesture, commitsDelete ? 'end' : 'start')
    const id = message.id
    if (commitsDelete) {
      window.setTimeout(() => onMessageAction?.(id, 'delete'), 140)
      return
    }
    if (rightAction) {
      const { action, target } = rightAction
      window.setTimeout(() => onMessageAction?.(id, action, target), 140)
    }
  }

  function handlePointerCancel() {
    const gesture = gestureRef.current
    if (gesture) {
      cancelLongPress(gesture)
      settleSwipe(gesture, null)
    }
    gestureRef.current = null
  }

  function handleRowClick(message: MessageSummary) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (isMobile && selectMode) {
      onToggleSelect?.(message.id)
      return
    }
    onSelect(message.id)
  }

  return (
    <section
      className={cn(
        'flex w-full shrink-0 flex-col overflow-hidden rounded-tl-2xl border-t border-l border-line bg-white',
        !fullWidth && 'md:w-[380px] xl:w-[430px]',
        className,
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-sm">
        {showToolbar ? (
          <>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded p-1 text-muted hover:bg-slate-100"
              aria-label={t('list.clearSelection')}
              title={t('list.clearSelection')}
            >
              <X size={16} />
            </button>
            <span className="text-xs font-medium">
              {selectedCount > 0
                ? t('list.selected', { count: selectedCount })
                : t('list.select')}
            </span>
            {selectedCount > 0 ? (
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
            ) : (
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(element) => {
                    if (element) {
                      element.indeterminate = someSelected && !allSelected
                    }
                  }}
                  onChange={() => onToggleSelectAll?.(allIds)}
                  className="h-3.5 w-3.5 shrink-0"
                />
                {t('list.selectAll')}
              </label>
            )}
          </>
        ) : (
          <>
            {canSelect && !isMobile ? (
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
        {loading && messages.length === 0 ? (
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
          <>
            {messages.map((message) => {
            const label = primaryLabel(message, fallback)
            const messageLabels = message.labelIds
              .map((id) => labels.find((item) => item.id === id))
              .filter((item): item is Label => Boolean(item))
            const checked = selectedSet.has(message.id)
            const showCheckbox = canSelect && (!isMobile || selectMode)
            return (
              <div
                key={message.id}
                className={cn(
                  'relative overflow-hidden border-b border-line/80',
                  checked
                    ? 'bg-brand-soft/70'
                    : selectedId === message.id
                      ? 'bg-blue-50'
                      : message.unread
                        ? 'bg-white'
                        : 'bg-slate-50/60',
                )}
              >
                {isMobile ? (
                  <div className="pointer-events-none absolute inset-0 flex items-stretch justify-between text-xs font-medium">
                    <div
                      className="flex flex-1 items-center gap-1.5 bg-emerald-50 px-4 text-emerald-700 transition-opacity duration-100"
                      style={{ opacity: 'var(--swipe-start, 0)' }}
                    >
                      {rightAction?.action === 'move' ? (
                        <Inbox size={16} />
                      ) : (
                        <ShieldAlert size={16} />
                      )}
                      {rightAction?.action === 'move'
                        ? t('list.moveInbox')
                        : t('list.spamAction')}
                    </div>
                    <div
                      className="flex flex-1 items-center justify-end gap-1.5 bg-red-50 px-4 text-brand-strong transition-opacity duration-100"
                      style={{ opacity: 'var(--swipe-end, 0)' }}
                    >
                      <Trash2 size={16} />
                      {t('list.delete')}
                    </div>
                  </div>
                ) : null}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRowClick(message)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) {
                      return
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect(message.id)
                    }
                  }}
                  onPointerDown={(event) => handlePointerDown(event, message)}
                  onPointerMove={(event) => handlePointerMove(event, message)}
                  onPointerUp={() => handlePointerUp(message)}
                  onPointerCancel={handlePointerCancel}
                  style={{ touchAction: 'pan-y' }}
                  className={cn(
                    'grid w-full cursor-pointer items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-100 focus:bg-slate-100 focus:outline-none sm:gap-3 sm:px-4',
                    showCheckbox
                      ? 'grid-cols-[auto_auto_1fr_auto]'
                      : 'grid-cols-[auto_1fr_auto]',
                  )}
                >
                  {showCheckbox ? (
                    <span
                      className="mt-2 flex items-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleSelect?.(message.id)}
                        aria-label={message.subject || t('list.noSubject')}
                        className="h-3.5 w-3.5"
                      />
                    </span>
                  ) : null}
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
                      {labelName || showFolder ? (
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
              </div>
            )
            })}
            {onLoadMore && hasMore ? (
              <div className="p-4">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {loadingMore ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  {t('list.loadMore')}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
