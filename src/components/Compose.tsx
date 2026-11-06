import type { ChangeEvent, FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Cloud,
  FileText,
  HardDrive,
  Paperclip,
  Save,
  Send,
  Server,
  Trash2,
  X,
} from 'lucide-react'
import type {
  Account,
  ComposeSeed,
  Contact,
  DraftPayload,
  DraftSavePayload,
  SignatureMode,
} from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { cn, fileToBase64, formatBytes, isValidEmail, parseAddresses } from '../lib/utils'
import { RecipientField } from './RecipientField'

interface PendingAttachment {
  filename: string
  contentType: string
  size: number
  base64: string
}

interface ComposeProps {
  accounts: Account[]
  contacts: Contact[]
  defaultAccountId: string | null
  maxAttachmentBytes: number
  defaultSignature: string
  signatureMode: SignatureMode
  initialDraft: DraftPayload | null
  seed: ComposeSeed | null
  onClose: () => void
  onSent: (warning?: string, sentFolder?: string) => void
  onSaved: () => void
  onDeleted: () => void
}

function base64Size(value: string): number {
  return Math.floor((value.length * 3) / 4)
}

function signatureOf(
  account: Account | undefined,
  fallback: string,
  mode: SignatureMode,
): string {
  if (mode === 'shared') {
    return fallback.trim()
  }
  return account?.signature?.trim() ?? ''
}

export function Compose({
  accounts,
  contacts,
  defaultAccountId,
  maxAttachmentBytes,
  defaultSignature,
  signatureMode,
  initialDraft,
  seed,
  onClose,
  onSent,
  onSaved,
  onDeleted,
}: ComposeProps) {
  const { t } = useI18n()
  const initialTo = initialDraft?.to ?? seed?.to ?? []
  const initialCc = initialDraft?.cc ?? seed?.cc ?? []
  const initialBcc = initialDraft?.bcc ?? seed?.bcc ?? []
  const initialAccountId =
    initialDraft?.accountId ?? seed?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? ''
  const initialSignature = signatureOf(
    accounts.find((item) => item.id === initialAccountId),
    defaultSignature,
    signatureMode,
  )
  const initialText = initialDraft
    ? initialDraft.text
    : seed
      ? initialSignature
        ? `${initialSignature}\n\n${seed.text.trimStart()}`
        : seed.text
      : initialSignature
  const [accountId, setAccountId] = useState(initialAccountId)
  const [to, setTo] = useState(initialTo.join(', '))
  const [cc, setCc] = useState(initialCc.join(', '))
  const [bcc, setBcc] = useState(initialBcc.join(', '))
  const [showCc, setShowCc] = useState(Boolean(initialCc.length))
  const [showBcc, setShowBcc] = useState(Boolean(initialBcc.length))
  const [subject, setSubject] = useState(initialDraft?.subject ?? seed?.subject ?? '')
  const [text, setText] = useState(initialText)
  const signatureRef = useRef(initialSignature)
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null)
  const [attachments, setAttachments] = useState<PendingAttachment[]>(
    (initialDraft?.attachments ?? []).map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: base64Size(attachment.dataBase64),
      base64: attachment.dataBase64,
    })),
  )
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [autoSaving, setAutoSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initialDraft ? Date.now() : null)
  const versionRef = useRef(0)
  const savingRef = useRef(false)
  const sendingRef = useRef(false)
  const mountedRef = useRef(false)
  const persistRef = useRef<(auto: boolean) => Promise<boolean>>(async () => false)
  const fileInput = useRef<HTMLInputElement>(null)

  const account = accounts.find((item) => item.id === accountId) ?? null
  const totalBytes = attachments.reduce((total, item) => total + item.size, 0)
  const limit = account?.maxAttachmentBytes ?? maxAttachmentBytes
  const limitMb = Math.max(1, Math.floor(limit / (1024 * 1024)))

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) {
      return
    }
    const incoming = files.reduce((total, file) => total + file.size, 0)
    if (totalBytes + incoming > limit) {
      setError(t('compose.attachmentsTooLarge', { limit: limitMb }))
      return
    }
    setError(null)
    const loaded: PendingAttachment[] = []
    for (const file of files) {
      loaded.push({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
        base64: await fileToBase64(file),
      })
    }
    setAttachments((current) => [...current, ...loaded])
  }

  function buildBasePayload(reportError = true): DraftSavePayload | null {
    if (!accountId) {
      if (reportError) {
        setError(t('compose.accountRequired'))
      }
      return null
    }
    const toAddresses = parseAddresses(to)
    const ccAddresses = parseAddresses(cc)
    const bccAddresses = parseAddresses(bcc)
    const invalid = [...toAddresses, ...ccAddresses, ...bccAddresses].find((address) => !isValidEmail(address))
    if (invalid) {
      if (reportError) {
        setError(t('compose.invalidAddress', { address: invalid }))
      }
      return null
    }
    return {
      accountId,
      draftId: draftId ?? undefined,
      to: toAddresses,
      cc: ccAddresses,
      bcc: bccAddresses,
      subject,
      text,
      attachments: attachments.map((item) => ({
        filename: item.filename,
        contentType: item.contentType,
        dataBase64: item.base64,
      })),
    }
  }

  function hasContent(): boolean {
    const body = text.trim()
    return Boolean(
      to.trim() ||
        cc.trim() ||
        bcc.trim() ||
        subject.trim() ||
        (body && body !== signatureRef.current.trim()) ||
        attachments.length > 0,
    )
  }

  async function persistDraft(auto: boolean): Promise<boolean> {
    if (savingRef.current || sendingRef.current || deleting) {
      return false
    }
    if (!hasContent()) {
      return false
    }
    const payload = buildBasePayload(!auto)
    if (!payload) {
      return false
    }
    const versionAtStart = versionRef.current
    savingRef.current = true
    if (auto) {
      setAutoSaving(true)
    } else {
      setSaving(true)
      setError(null)
    }
    try {
      const result = await api.saveDraft(payload)
      if (result.draftId) {
        setDraftId(result.draftId)
      }
      if (versionRef.current === versionAtStart) {
        setDirty(false)
        setLastSavedAt(Date.now())
      }
      return true
    } catch (err) {
      setError(errorText(err, t))
      return false
    } finally {
      savingRef.current = false
      if (auto) {
        setAutoSaving(false)
      } else {
        setSaving(false)
      }
    }
  }

  useEffect(() => {
    persistRef.current = persistDraft
  })

  useEffect(() => {
    const next = signatureOf(
      accounts.find((item) => item.id === accountId),
      defaultSignature,
      signatureMode,
    )
    if (next === signatureRef.current) {
      return
    }
    setText((current) => {
      const trimmed = current.trim()
      if (!trimmed || trimmed === signatureRef.current.trim()) {
        return next
      }
      return current
    })
    signatureRef.current = next
  }, [accountId, accounts, defaultSignature, signatureMode])

  async function saveDraftManually() {
    const saved = await persistDraft(false)
    if (saved) {
      onSaved()
    }
  }

  async function handleClose() {
    if (busy || deleting) {
      return
    }
    if (!dirty || !hasContent()) {
      onClose()
      return
    }
    const saved = await persistRef.current(false)
    if (saved) {
      onClose()
    }
  }

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    versionRef.current += 1
    setDirty(true)
  }, [accountId, to, cc, bcc, subject, text, attachments])

  useEffect(() => {
    if (!dirty || busy || deleting) {
      return
    }
    const timer = window.setTimeout(() => {
      void persistRef.current(true)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [dirty, busy, deleting, accountId, to, cc, bcc, subject, text, attachments, draftId])

  useEffect(() => {
    if (!dirty || busy || deleting) {
      return
    }
    const interval = window.setInterval(() => {
      void persistRef.current(true)
    }, 30_000)
    return () => window.clearInterval(interval)
  }, [dirty, busy, deleting])

  async function removeDraft() {
    if (!draftId) {
      return
    }
    setDeleting(true)
    setError(null)
    try {
      await api.deleteDraft(draftId)
      onDeleted()
    } catch (err) {
      setError(errorText(err, t))
    } finally {
      setDeleting(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (savingRef.current) {
      return
    }
    const payload = buildBasePayload()
    if (!payload) {
      return
    }
    if (payload.to.length === 0) {
      setError(t('compose.recipientRequired'))
      return
    }
    sendingRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await api.send(payload)
      onSent(result.warning, result.sentFolder)
    } catch (err) {
      sendingRef.current = false
      setError(errorText(err, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          void handleClose()
        }
      }}
    >
      <form
        onSubmit={submit}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-medium">{t('compose.title')}</h2>
          <button
            type="button"
            onClick={() => void handleClose()}
            className="rounded-full p-1.5 text-muted hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 border-b border-line px-5 py-2 text-sm">
            <span className="w-14 shrink-0 text-xs text-muted">{t('compose.from')}</span>
            {accounts.length > 1 ? (
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                className="w-full bg-transparent text-sm outline-none"
              >
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} &lt;{item.email}&gt;
                  </option>
                ))}
              </select>
            ) : (
              <span className="truncate">
                {account ? `${account.displayName} <${account.email}>` : ''}
              </span>
            )}
            {account ? (
              <span className="ml-auto flex items-center gap-1 text-[10px] text-muted">
                {account.kind === 'imap' ? (
                  <Server size={12} />
                ) : account.storageDriver === 'drive' ? (
                  <Cloud size={12} />
                ) : (
                  <HardDrive size={12} />
                )}
                {account.kind === 'imap'
                  ? t('compose.provider')
                  : account.storageDriver === 'drive'
                    ? t('settings.drive')
                    : t('settings.r2')}
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-b border-line px-5 py-2 text-sm">
            <span className="w-14 shrink-0 text-xs text-muted">{t('compose.to')}</span>
            <RecipientField
              value={to}
              onChange={setTo}
              contacts={contacts}
              placeholder="destinatario@dominio.it"
              inputClassName="w-full bg-transparent outline-none"
            />
            <div className="flex shrink-0 gap-2 text-xs text-muted">
              {!showCc ? (
                <button type="button" onClick={() => setShowCc(true)} className="hover:text-slate-700">
                  {t('compose.cc')}
                </button>
              ) : null}
              {!showBcc ? (
                <button type="button" onClick={() => setShowBcc(true)} className="hover:text-slate-700">
                  {t('compose.bcc')}
                </button>
              ) : null}
            </div>
          </div>

          {showCc ? (
            <div className="flex items-center gap-3 border-b border-line px-5 py-2 text-sm">
              <span className="w-14 shrink-0 text-xs text-muted">{t('compose.cc')}</span>
              <RecipientField
                value={cc}
                onChange={setCc}
                contacts={contacts}
                inputClassName="w-full bg-transparent outline-none"
              />
            </div>
          ) : null}

          {showBcc ? (
            <div className="flex items-center gap-3 border-b border-line px-5 py-2 text-sm">
              <span className="w-14 shrink-0 text-xs text-muted">{t('compose.bcc')}</span>
              <RecipientField
                value={bcc}
                onChange={setBcc}
                contacts={contacts}
                inputClassName="w-full bg-transparent outline-none"
              />
            </div>
          ) : null}

          <div className="border-b border-line px-5 py-2 text-sm">
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder={t('compose.subject')}
              maxLength={500}
              className="w-full bg-transparent outline-none"
            />
          </div>

          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('compose.body')}
            className="min-h-48 w-full resize-y px-5 py-4 text-sm leading-6 outline-none"
          />

          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-5 pb-4">
              {attachments.map((item, index) => (
                <span
                  key={`${item.filename}-${index}`}
                  className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-2.5 py-1.5 text-xs"
                >
                  <FileText size={14} className="text-slate-500" />
                  <span className="max-w-48 truncate">{item.filename}</span>
                  <span className="text-[10px] text-muted">{formatBytes(item.size)}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="rounded-full p-0.5 text-muted hover:bg-slate-200"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {account?.kind === 'relay' && account.storageDriver === 'drive' && !account.driveConnected ? (
            <p className="mx-5 mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('compose.driveNotConnected')}
            </p>
          ) : null}
          {account?.kind === 'imap' && !account.connected ? (
            <p className="mx-5 mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('compose.notAuthenticated')}
            </p>
          ) : null}
          {error ? (
            <p className="mx-5 mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-brand-strong">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <input ref={fileInput} type="file" multiple onChange={addFiles} className="hidden" />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-slate-100"
            >
              <Paperclip size={16} />
              {t('compose.attach')}
            </button>
            {totalBytes > 0 ? (
              <span className="text-[10px] text-muted">
                {formatBytes(totalBytes)} / {limitMb} MB
              </span>
            ) : null}
            {dirty || autoSaving || saving ? (
              <span className="text-[10px] text-muted">
                {autoSaving || saving ? t('compose.savingDraft') : t('compose.unsaved')}
              </span>
            ) : lastSavedAt ? (
              <span className="text-[10px] text-emerald-600">{t('compose.saved')}</span>
            ) : null}
            {draftId ? (
              <button
                type="button"
                disabled={deleting}
                onClick={() => void removeDraft()}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-muted hover:bg-red-50 hover:text-brand-strong disabled:opacity-50"
              >
                <Trash2 size={14} />
                {t('compose.deleteDraft')}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving || autoSaving || busy || deleting || !account}
              onClick={() => void saveDraftManually()}
              className="flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Save size={16} />
              {saving ? t('compose.savingDraft') : t('compose.saveDraft')}
            </button>
            <button
              type="submit"
              disabled={busy || saving || autoSaving || !account}
              className={cn(
                'flex items-center gap-2 rounded-full bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand-strong',
                (busy || saving || autoSaving || !account) && 'opacity-60',
              )}
            >
              <Send size={16} />
              {busy ? t('compose.sending') : t('compose.send')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
