import { useRef, useState, type ReactNode } from 'react'
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
  allowRemoteImages?: boolean
  rawUrl: string | null
  attachmentUrl: (index: number) => string
  onBack?: () => void
  onReply: (all: boolean) => void
  onSetLabels: (labelIds: string[]) => void
  onDelete?: () => void
  onToggleSpam?: () => void
  onAlwaysShowImages?: () => void
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

function ToolbarButton({
  label,
  onClick,
  href,
  disabled,
  children,
}: {
  label: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  children: ReactNode
}) {
  const className =
    'flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 disabled:opacity-40'
  if (href) {
    return (
      <a href={href} title={label} aria-label={label} className={className}>
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </button>
  )
}

export function ReadingPane({
  message,
  labels,
  loading,
  error,
  allowRemoteImages = false,
  rawUrl,
  attachmentUrl,
  onBack,
  onReply,
  onSetLabels,
  onDelete,
  onToggleSpam,
  onAlwaysShowImages,
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
  const showImages = imageState.id === message?.id ? imageState.show : allowRemoteImages
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
      <section className="flex min-w-0 flex-1 flex-col rounded-tr-2xl border-t border-r border-line bg-white">
        {onBack ? (
          <div className="px-2 py-2">
            <ToolbarButton label={t('reading.back')} onClick={onBack}>
              <ArrowLeft size={18} />
            </ToolbarButton>
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
      <section className="flex min-w-0 flex-1 flex-col rounded-tr-2xl border-t border-r border-line bg-white">
        {onBack ? (
          <div className="px-2 py-2">
            <ToolbarButton label={t('reading.back')} onClick={onBack}>
              <ArrowLeft size={18} />
            </ToolbarButton>
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
      <section className="hidden min-w-0 flex-1 items-center justify-center rounded-tr-2xl border-t border-r border-line bg-white lg:flex">
        <div className="flex flex-col items-center gap-3 text-muted">
          <Mail size={44} className="text-slate-300" />
          <p className="text-sm">{t('reading.select')}</p>
        </div>
      </section>
    )
  }

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
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line/80 px-1.5 py-1.5 sm:px-3">
        {onBack ? (
          <ToolbarButton label={t('reading.back')} onClick={onBack}>
            <ArrowLeft size={18} />
          </ToolbarButton>
        ) : null}
        {onDelete ? (
          <ToolbarButton label={t('reading.delete')} onClick={onDelete} disabled={actionBusy}>
            <Trash2 size={17} />
          </ToolbarButton>
        ) : null}
        {onToggleSpam ? (
          <ToolbarButton label={message.folder === 'spam' ? t('reading.notSpam') : t('reading.spam')} onClick={onToggleSpam} disabled={actionBusy}>
            {message.folder === 'spam' ? <ShieldCheck size={17} /> : <ShieldAlert size={17} />}
          </ToolbarButton>
        ) : null}
        <details className="relative">
          <summary
            title={t('reading.labels')}
            aria-label={t('reading.labels')}
            className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
          >
            <Tag size={17} />
          </summary>
          <div className="absolute left-0 z-30 mt-1 w-60 max-w-[calc(100vw-1rem)] rounded-xl border border-line bg-white p-2 shadow-lg">
            {labels.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted">{t('reading.noLabels')}</p>
            ) : (
              labels.map((label) => {
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
          <ToolbarButton label={t('reading.downloadEml')} href={rawUrl}>
            <Download size={17} />
          </ToolbarButton>
        ) : null}
        <div className="ml-auto flex items-center gap-1 pr-1 text-xs text-muted">
          <span className="hidden sm:inline">{formatDate(message.date, locale)}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-4 py-4 sm:px-8 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <h1 className="min-w-0 flex-1 text-xl font-normal leading-tight text-slate-900 sm:text-2xl">
              {message.subject || t('list.noSubject')}
            </h1>
          </div>

          {message.labelIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
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

          <div className="mt-4 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-strong">
              {initials(senderName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="truncate text-sm font-medium text-slate-900">{senderName}</span>
                <span className="truncate text-xs text-muted">&lt;{message.from.email}&gt;</span>
              </div>
              <details className="relative">
                <summary className="mt-0.5 flex w-fit max-w-full cursor-pointer list-none items-center gap-1 text-xs text-muted hover:text-slate-700">
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
            <div className="flex shrink-0 items-center gap-1">
              <span className="hidden pt-1 text-xs text-muted sm:inline">
                {formatDate(message.date, locale)}
              </span>
              <button
                type="button"
                onClick={() => onReply(false)}
                className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Reply size={14} />
                <span className="hidden sm:inline">{t('reading.reply')}</span>
              </button>
            </div>
          </div>

          <div className="mt-5">
            {html ? (
              <>
                {hasImages && !showImages ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <span>{t('reading.imagesBlocked')}</span>
                    <span className="flex items-center gap-2">
                      {onAlwaysShowImages ? (
                        <button
                          type="button"
                          onClick={onAlwaysShowImages}
                          className="rounded-lg px-2 py-1 font-medium text-amber-900 underline hover:bg-amber-100"
                        >
                          {t('reading.alwaysShowImages')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setImageState({ id: message.id, show: true })}
                        className="rounded-lg bg-amber-900 px-2.5 py-1 font-medium text-white hover:bg-amber-800"
                      >
                        {t('reading.showImages')}
                      </button>
                    </span>
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
          </div>

          {message.attachments.length > 0 ? (
            <div className="mt-6 border-t border-line pt-4">
              <p className="mb-2 text-xs font-medium text-muted">
                {t('reading.attachments', { count: message.attachments.length })}
              </p>
              <div className="flex flex-wrap gap-3">
                {message.attachments.map((attachment) => (
                  <a
                    key={`${attachment.index}-${attachment.filename}`}
                    href={attachmentUrl(attachment.index)}
                    className="flex w-60 max-w-full items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 hover:border-slate-300 hover:bg-slate-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      <FileText size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-slate-800">
                        {attachment.filename}
                      </span>
                      <span className="block text-[10px] text-muted">
                        {formatBytes(attachment.size)}
                      </span>
                    </span>
                    <Download size={15} className="shrink-0 text-muted" />
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => onReply(false)}
              className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Reply size={16} />
              {t('reading.reply')}
            </button>
            <button
              type="button"
              onClick={() => onReply(true)}
              className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ReplyAll size={16} />
              {t('reading.replyAll')}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
