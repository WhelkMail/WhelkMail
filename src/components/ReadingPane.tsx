import { useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  Download,
  FileText,
  Mail,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  Tag,
  Trash2,
} from 'lucide-react'
import type { Label, MessageDetail } from '../../shared/types'
import { useI18n } from '../i18n'
import {
  cn,
  displayAddress,
  formatBytes,
  formatDate,
  initials,
  labelStyle,
} from '../lib/utils'

interface ReadingPaneProps {
  message: MessageDetail | null
  labels: Label[]
  loading: boolean
  error: string | null
  rawUrl: string | null
  attachmentUrl: (index: number) => string
  onBack?: () => void
  onReply: (all: boolean) => void
  onSetLabels: (labelIds: string[]) => void
  onDelete?: () => void
  onToggleSpam?: () => void
  actionBusy?: boolean
}

function emailDocument(
  html: string,
  allowImages: boolean,
  cidMap: Map<string, string>,
): string {
  const imgSrc = allowImages ? '* data: blob: cid:' : 'data:'
  const clean = html
    .replace(/\bsrc\s*=\s*(["'])cid:([^"']+)\1/gi, (match, quote: string, cid: string) => {
      let key = cid
      try {
        key = decodeURIComponent(cid)
      } catch {
        // Keep the raw content id if it is not valid percent-encoding.
      }
      const url = cidMap.get(key.replace(/[<>]/g, ''))
      return url ? `src=${quote}${url}${quote}` : match
    })
    .replace(/<\s*(script|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*base[^>]*>/gi, '')
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
    .replace(
      /<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi,
      '',
    )
    .replace(/<a\b([^>]*)>/gi, (match, attrs: string) =>
      /\btarget\s*=/i.test(attrs)
        ? match.replace(/\btarget\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, 'target="_blank"')
        : `<a${attrs} target="_blank" rel="noopener noreferrer">`,
    )
  const style = [
    'html,body{margin:0;padding:0;background:#fff}',
    'body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;',
    'font-size:14px;line-height:1.5;color:#202124;word-break:break-word;overflow-wrap:anywhere}',
    'img{max-width:100%;height:auto}table{max-width:100%}a{color:#1a73e8}',
  ].join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; media-src 'none';"><style>${style}</style></head><body>${clean}</body></html>`
}

export function ReadingPane({
  message,
  labels,
  loading,
  error,
  rawUrl,
  attachmentUrl,
  onBack,
  onReply,
  onSetLabels,
  onDelete,
  onToggleSpam,
  actionBusy = false,
}: ReadingPaneProps) {
  const { t, locale } = useI18n()
  const [imageState, setImageState] = useState<{ id: string | null; show: boolean }>({
    id: null,
    show: false,
  })
  const [frameState, setFrameState] = useState<{ id: string | null; height: number }>({
    id: null,
    height: 420,
  })
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const html = message?.html?.trim() ?? ''
  const hasImages =
    /(?:src|srcset)\s*=\s*["']?[^"'\s>]*(?:https?:|\/\/|cid:)/i.test(html) ||
    /url\(\s*["']?(?:https?:|\/\/|cid:)/i.test(html)
  const showImages = imageState.id === message?.id ? imageState.show : false
  const frameHeight = frameState.id === message?.id ? frameState.height : 420
  const cidMap = new Map<string, string>()
  for (const attachment of message?.attachments ?? []) {
    if (!attachment.contentId) {
      continue
    }
    const base = attachmentUrl(attachment.index)
    cidMap.set(
      attachment.contentId,
      base.includes('?') ? `${base}&inline=1` : `${base}?inline=1`,
    )
  }

  if (loading) {
    return (
      <section className="flex min-w-0 flex-1 flex-col rounded-tr-2xl border-t border-r border-line bg-white/60">
        {onBack ? (
          <div className="px-4 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-slate-100"
            >
              <ArrowLeft size={16} /> {t('reading.back')}
            </button>
          </div>
        ) : null}
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg animate-pulse space-y-3 px-8">
            <div className="h-5 w-2/3 rounded bg-slate-200" />
            <div className="h-3 w-1/2 rounded bg-slate-100" />
            <div className="h-3 w-1/3 rounded bg-slate-100" />
          </div>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="flex min-w-0 flex-1 flex-col rounded-tr-2xl border-t border-r border-line bg-white/60">
        {onBack ? (
          <div className="px-4 pt-4">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-slate-100"
            >
              <ArrowLeft size={16} /> {t('reading.back')}
            </button>
          </div>
        ) : null}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertCircle size={28} className="text-brand" />
          <p className="text-sm text-slate-700">{error}</p>
        </div>
      </section>
    )
  }

  if (!message) {
    return (
      <section className="hidden min-w-0 flex-1 items-center justify-center rounded-tr-2xl border-t border-r border-line bg-white/60 lg:flex">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Mail size={44} className="text-slate-300" />
          <p className="text-sm">{t('reading.select')}</p>
        </div>
      </section>
    )
  }

  const availableLabels = labels
  const senderName = message.from.name?.trim() || message.from.email || t('list.unknownSender')
  const toMe = message.to.some(
    (item) => item.email.toLowerCase() === message.accountEmail.toLowerCase(),
  )
  const recipientSummary = toMe
    ? t('reading.toMe')
    : message.to.length > 0
      ? `${t('reading.toShort')} ${message.to.map(displayAddress).join(', ')}`
      : t('reading.toMe')

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-tl-2xl rounded-tr-2xl border-t border-l border-r border-line bg-white">
      <div className="border-b border-line px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-start gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-slate-100"
            >
              <ArrowLeft size={16} /> {t('reading.back')}
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <h2 className="min-w-0 flex-1 truncate text-lg font-medium sm:text-xl">
                {message.subject || t('list.noSubject')}
              </h2>
              <span className="shrink-0 pt-1 text-xs text-muted">
                {formatDate(message.date, locale)}
              </span>
            </div>

            {message.labelIds.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {message.labelIds.map((id) => {
                  const item = labels.find((label) => label.id === id)
                  return item ? (
                    <span
                      key={id}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] font-medium',
                        labelStyle(item.color),
                      )}
                    >
                      {item.name}
                    </span>
                  ) : null
                })}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-strong">
                {initials(senderName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{senderName}</p>
                <details className="relative">
                  <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-1 text-xs text-muted hover:text-slate-700">
                    <span className="truncate">{recipientSummary}</span>
                    <ChevronDown size={12} className="shrink-0" />
                  </summary>
                  <div className="absolute left-0 z-30 mt-1 w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-line bg-white p-3 text-xs shadow-lg">
                    <p>
                      <span className="font-medium text-slate-600">{t('reading.from')}</span>{' '}
                      {displayAddress(message.from)}
                    </p>
                    <p className="mt-1">
                      <span className="font-medium text-slate-600">{t('reading.to')}</span>{' '}
                      {message.to.map((item) => displayAddress(item)).join(', ') || '—'}
                    </p>
                    {message.cc.length > 0 ? (
                      <p className="mt-1">
                        <span className="font-medium text-slate-600">{t('reading.cc')}</span>{' '}
                        {message.cc.map((item) => displayAddress(item)).join(', ')}
                      </p>
                    ) : null}
                    <p className="mt-1">
                      <span className="font-medium text-slate-600">{t('reading.date')}</span>{' '}
                      {formatDate(message.date, locale)}
                    </p>
                    <p className="mt-1">
                      <span className="font-medium text-slate-600">{t('reading.size')}</span>{' '}
                      {formatBytes(message.size)}
                    </p>
                  </div>
                </details>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => onReply(false)}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:px-3 sm:py-2"
                >
                  <Reply size={14} />
                  {t('reading.reply')}
                </button>
                <button
                  type="button"
                  onClick={() => onReply(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:px-3 sm:py-2"
                >
                  <ReplyAll size={14} />
                  {t('reading.replyAll')}
                </button>
                {onDelete ? (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={onDelete}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-red-50 hover:text-brand-strong disabled:opacity-50 sm:px-3 sm:py-2"
                  >
                    <Trash2 size={14} />
                    {t('reading.delete')}
                  </button>
                ) : null}
                {onToggleSpam ? (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={onToggleSpam}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-amber-50 disabled:opacity-50 sm:px-3 sm:py-2"
                  >
                    {message.folder === 'spam' ? (
                      <ShieldCheck size={14} />
                    ) : (
                      <ShieldAlert size={14} />
                    )}
                    {message.folder === 'spam' ? t('reading.notSpam') : t('reading.spam')}
                  </button>
                ) : null}
                <details className="relative">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:px-3 sm:py-2">
                    <Tag size={14} />
                    {t('reading.labels')}
                  </summary>
                  <div className="absolute right-0 z-20 mt-1 w-60 max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-white p-2 shadow-lg">
                    {availableLabels.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted">{t('reading.noLabels')}</p>
                    ) : (
                      availableLabels.map((label) => {
                        const checked = message.labelIds.includes(label.id)
                        return (
                          <label
                            key={label.id}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                onSetLabels(
                                  checked
                                    ? message.labelIds.filter((id) => id !== label.id)
                                    : [...message.labelIds, label.id],
                                )
                              }
                              className="h-3.5 w-3.5"
                            />
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                                labelStyle(label.color),
                              )}
                            >
                              {label.name}
                            </span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </details>
                {rawUrl ? (
                  <a
                    href={rawUrl}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:px-3 sm:py-2"
                  >
                    <Download size={14} />
                    {t('reading.downloadEml')}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {html ? (
          <>
            {hasImages && !showImages ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <span>{t('reading.imagesBlocked')}</span>
                <button
                  type="button"
                  onClick={() => setImageState({ id: message.id, show: true })}
                  className="rounded-lg bg-amber-900 px-2.5 py-1 font-medium text-white hover:bg-amber-800"
                >
                  {t('reading.showImages')}
                </button>
              </div>
            ) : null}
            {hasImages && showImages ? (
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setImageState({ id: message.id, show: false })}
                  className="text-xs text-muted underline hover:text-slate-700"
                >
                  {t('reading.hideImages')}
                </button>
              </div>
            ) : null}
            <iframe
              ref={frameRef}
              title={message.subject || t('list.noSubject')}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              srcDoc={emailDocument(html, showImages, cidMap)}
              onLoad={() => {
                const doc = frameRef.current?.contentDocument
                if (!doc) {
                  return
                }
                const resize = () => {
                  setFrameState({
                    id: message.id,
                    height: Math.min(20000, Math.max(320, doc.documentElement.scrollHeight + 8)),
                  })
                }
                resize()
                for (const image of Array.from(doc.images)) {
                  image.addEventListener('load', resize)
                }
              }}
              style={{ height: `${frameHeight}px` }}
              className="w-full border-0 bg-white"
            />
          </>
        ) : message.text ? (
          <div className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{message.text}</div>
        ) : (
          <p className="text-sm text-muted">{t('reading.noText')}</p>
        )}

        {message.attachments.length > 0 ? (
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-2 text-xs font-medium text-muted">
              {t('reading.attachments', { count: message.attachments.length })}
            </p>
            <div className="flex flex-wrap gap-2">
              {message.attachments.map((attachment) => (
                <a
                  key={`${attachment.index}-${attachment.filename}`}
                  href={attachmentUrl(attachment.index)}
                  className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2 hover:border-slate-300 hover:bg-slate-100"
                >
                  <FileText size={16} className="text-slate-500" />
                  <div className="min-w-0">
                    <p className="max-w-56 truncate text-xs font-medium">{attachment.filename}</p>
                    <p className="text-[10px] text-muted">{formatBytes(attachment.size)}</p>
                  </div>
                  <Download size={13} className="ml-2 text-muted" />
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
