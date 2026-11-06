import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Download, Pencil, Plus, Search, Trash2, Upload, Users } from 'lucide-react'
import type { Contact, ContactInput } from '../../shared/types'
import { useI18n } from '../i18n'
import { cn, initials } from '../lib/utils'

interface ContactsProps {
  contacts: Contact[]
  onCreate: (input: ContactInput) => Promise<Contact | null>
  onUpdate: (id: string, input: ContactInput) => Promise<boolean>
  onDelete: (id: string) => void
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }
  if (cell || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((item) => item.some((value) => value.trim()))
}

export function Contacts({ contacts, onCreate, onUpdate, onDelete }: ContactsProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? contacts.filter((contact) =>
        `${contact.name} ${contact.email} ${contact.note}`.toLowerCase().includes(needle),
      )
    : contacts

  function resetForm() {
    setEditingId(null)
    setName('')
    setEmail('')
    setNote('')
    setError(null)
  }

  function startEdit(contact: Contact) {
    setEditingId(contact.id)
    setName(contact.name)
    setEmail(contact.email)
    setNote(contact.note)
    setError(null)
    setMessage(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (!trimmedName || !trimmedEmail) {
      setError(t('contacts.required'))
      return
    }
    if (!trimmedEmail.includes('@')) {
      setError(t('contacts.invalidEmail'))
      return
    }
    setBusy(true)
    const input: ContactInput = { name: trimmedName, email: trimmedEmail, note: note.trim() }
    if (editingId) {
      const updated = await onUpdate(editingId, input)
      setBusy(false)
      if (updated) {
        setMessage(t('contacts.updated'))
        resetForm()
      }
    } else {
      const created = await onCreate(input)
      setBusy(false)
      if (created) {
        setMessage(t('contacts.created'))
        resetForm()
      }
    }
  }

  function exportCsv() {
    const lines = [
      'name,email,note',
      ...contacts.map((contact) =>
        [contact.name, contact.email, contact.note].map(csvCell).join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'contacts.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    const rows = parseCsv(await file.text())
    event.target.value = ''
    const start = rows[0]?.[0]?.trim().toLowerCase() === 'name' ? 1 : 0
    let imported = 0
    let failed = 0
    for (const row of rows.slice(start)) {
      const rowName = row[0]?.trim() ?? ''
      const rowEmail = row[1]?.trim() ?? ''
      if (!rowName || !rowEmail.includes('@')) {
        failed += 1
        continue
      }
      const created = await onCreate({ name: rowName, email: rowEmail, note: row[2]?.trim() ?? '' })
      if (created) {
        imported += 1
      } else {
        failed += 1
      }
    }
    setMessage(
      failed > 0
        ? t('contacts.importedPartial', { imported, failed })
        : t('contacts.imported', { count: imported }),
    )
  }

  const inputClass =
    'w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users size={20} className="text-muted" />
            <h2 className="text-lg font-medium">{t('contacts.title')}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              <Upload size={14} /> {t('contacts.import')}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={contacts.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              <Download size={14} /> {t('contacts.export')}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => void importCsv(event)}
              className="hidden"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-5">
          <label className="relative block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('contacts.search')}
              className="w-full rounded-full bg-slate-100 py-2 pl-9 pr-4 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-line"
            />
          </label>

          <form onSubmit={submit} className="mt-4 rounded-xl border border-line p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <Plus size={13} /> {editingId ? t('contacts.edit') : t('contacts.new')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('contacts.name')}
                className={inputClass}
                required
              />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('contacts.email')}
                className={inputClass}
                required
              />
            </div>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('contacts.note')}
              className={`${inputClass} mt-2`}
            />
            {error ? <p className="mt-2 text-xs text-brand-strong">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              {editingId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-slate-50"
                >
                  {t('common.cancel')}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={busy || !name.trim() || !email.trim()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? t('common.loading') : editingId ? t('common.save') : t('contacts.add')}
              </button>
            </div>
          </form>

          {message ? <p className="mt-3 text-xs text-emerald-700">{message}</p> : null}

          <div className="mt-4 space-y-1">
            {visible.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-muted">
                {contacts.length === 0 ? t('contacts.empty') : t('contacts.noResults')}
              </p>
            ) : null}
            {visible.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-strong">
                  {initials(contact.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{contact.name}</p>
                  <p className="truncate text-xs text-muted">{contact.email}</p>
                  {contact.note ? (
                    <p className="truncate text-[11px] text-muted">{contact.note}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(contact)}
                    className={cn(
                      'rounded-full p-1.5 text-muted hover:bg-slate-100',
                      editingId === contact.id && 'bg-slate-100 text-slate-700',
                    )}
                    aria-label={t('contacts.edit')}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(contact.id)}
                    className="rounded-full p-1.5 text-muted hover:bg-red-50 hover:text-brand-strong"
                    aria-label={t('contacts.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
