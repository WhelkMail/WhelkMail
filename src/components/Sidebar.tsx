import { useState, type FormEvent } from 'react'
import {
  Cloud,
  FileText,
  HardDrive,
  Inbox,
  Pencil,
  Plus,
  Send,
  Server,
  Settings,
  ShieldAlert,
  Tag,
  Users,
  X,
} from 'lucide-react'
import type { Account, Folder, Label, LabelColor, LabelInput } from '../../shared/types'
import { useI18n } from '../i18n'
import { LABEL_COLORS, cn, labelDot, labelStyle } from '../lib/utils'
import { WhelkLogo } from './WhelkLogo'

interface SidebarProps {
  account: Account | null
  view: 'mail' | 'settings' | 'contacts'
  folder: Folder
  labels: Label[]
  selectedLabelId: string | null
  mobileOpen: boolean
  onCompose: () => void
  onFolder: (folder: Folder) => void
  onSelectLabel: (id: string | null) => void
  onCreateLabel: (name: string, color: LabelColor) => Promise<Label | null>
  onUpdateLabel: (id: string, input: LabelInput) => Promise<Label | null>
  onDeleteLabel: (id: string) => void
  onSettings: () => void
  onContacts: () => void
  onAddAccount: () => void
  onClose: () => void
}

export function Sidebar({
  account,
  view,
  folder,
  labels,
  selectedLabelId,
  mobileOpen,
  onCompose,
  onFolder,
  onSelectLabel,
  onCreateLabel,
  onUpdateLabel,
  onDeleteLabel,
  onSettings,
  onContacts,
  onAddAccount,
  onClose,
}: SidebarProps) {
  const { t } = useI18n()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<LabelColor>('blue')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<LabelColor>('blue')
  const [editBusy, setEditBusy] = useState(false)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || busy) {
      return
    }
    setBusy(true)
    const created = await onCreateLabel(name.trim(), color)
    setBusy(false)
    if (created) {
      setName('')
      setShowCreate(false)
    }
  }

  function startEdit(label: Label) {
    setEditingId(label.id)
    setEditName(label.name)
    setEditColor(label.color)
    setShowCreate(false)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditName('')
  }

  async function saveEdit(event: FormEvent, label: Label) {
    event.preventDefault()
    const nextName = editName.trim()
    if (!nextName || editBusy) {
      return
    }
    if (nextName === label.name && editColor === label.color) {
      cancelEdit()
      return
    }
    setEditBusy(true)
    const updated = await onUpdateLabel(label.id, { name: nextName, color: editColor })
    setEditBusy(false)
    if (updated) {
      cancelEdit()
    }
  }

  function openFolder(next: Folder) {
    onFolder(next)
    onClose()
  }

  return (
    <>
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 max-w-full shrink-0 flex-col gap-2 overflow-y-auto bg-canvas px-3 py-4 shadow-xl transition-transform md:static md:z-auto md:w-60 md:translate-x-0 md:bg-transparent md:shadow-none',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-4 flex items-center gap-2 px-3">
          <WhelkLogo size={24} className="text-brand" />
          <span className="text-xl font-medium tracking-tight">{t('app.name')}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full p-1.5 text-muted hover:bg-slate-200/60 md:hidden"
            aria-label={t('common.close')}
          >
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            onCompose()
            onClose()
          }}
          className="mb-4 flex w-fit items-center gap-3 rounded-2xl bg-brand-soft px-5 py-3 text-sm font-medium text-brand-strong shadow-sm transition hover:bg-red-100"
        >
          <Pencil size={18} />
          {t('sidebar.compose')}
        </button>

        <nav className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => openFolder('inbox')}
            className={cn(
              'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
              view === 'mail' && folder === 'inbox' && !selectedLabelId
                ? 'bg-brand-soft font-medium text-brand-strong'
                : 'text-slate-700 hover:bg-slate-200/60',
            )}
          >
            <Inbox size={18} />
            {t('sidebar.inbox')}
          </button>
          <button
            type="button"
            onClick={() => openFolder('sent')}
            className={cn(
              'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
              view === 'mail' && folder === 'sent' && !selectedLabelId
                ? 'bg-brand-soft font-medium text-brand-strong'
                : 'text-slate-700 hover:bg-slate-200/60',
            )}
          >
            <Send size={18} />
            {t('sidebar.sent')}
          </button>
          <button
            type="button"
            onClick={() => openFolder('draft')}
            className={cn(
              'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
              view === 'mail' && folder === 'draft' && !selectedLabelId
                ? 'bg-brand-soft font-medium text-brand-strong'
                : 'text-slate-700 hover:bg-slate-200/60',
            )}
          >
            <FileText size={18} />
            {t('sidebar.drafts')}
          </button>
          <button
            type="button"
            onClick={() => openFolder('spam')}
            className={cn(
              'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
              view === 'mail' && folder === 'spam' && !selectedLabelId
                ? 'bg-brand-soft font-medium text-brand-strong'
                : 'text-slate-700 hover:bg-slate-200/60',
            )}
          >
            <ShieldAlert size={18} />
            {t('sidebar.spam')}
          </button>
          <button
            type="button"
            onClick={() => {
              onContacts()
              onClose()
            }}
            className={cn(
              'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
              view === 'contacts'
                ? 'bg-brand-soft font-medium text-brand-strong'
                : 'text-slate-700 hover:bg-slate-200/60',
            )}
          >
            <Users size={18} />
            {t('sidebar.contacts')}
          </button>
          <button
            type="button"
            onClick={() => {
              onSettings()
              onClose()
            }}
            className={cn(
              'flex items-center gap-3 rounded-full px-4 py-2 text-sm',
              view === 'settings'
                ? 'bg-brand-soft font-medium text-brand-strong'
                : 'text-slate-700 hover:bg-slate-200/60',
            )}
          >
            <Settings size={18} />
            {t('sidebar.settings')}
          </button>
          <button
            type="button"
            onClick={() => {
              onAddAccount()
              onClose()
            }}
            className="flex items-center gap-3 rounded-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-200/60"
          >
            <Plus size={18} />
            {t('sidebar.addAccount')}
          </button>
        </nav>

        <div className="mt-4 border-t border-line pt-3">
          <div className="flex items-center justify-between px-4 pb-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {t('sidebar.labels')}
            </span>
            <button
              type="button"
              onClick={() => setShowCreate((current) => !current)}
              className="rounded-full p-1 text-muted hover:bg-slate-200/60"
              aria-label={t('labels.new')}
              title={t('labels.new')}
            >
              <Plus size={15} />
            </button>
          </div>

          {showCreate ? (
            <form onSubmit={create} className="mb-2 rounded-xl border border-line bg-white p-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('labels.name')}
                maxLength={40}
                autoFocus
                className="w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {LABEL_COLORS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setColor(item.id)}
                    aria-label={item.id}
                    className={cn(
                      'h-4 w-4 rounded-full ring-offset-1',
                      item.dot,
                      color === item.id ? 'ring-2 ring-slate-700' : '',
                    )}
                  />
                ))}
              </div>
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="mt-2 w-full rounded-lg bg-slate-900 px-2 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {busy ? t('common.loading') : t('labels.create')}
              </button>
            </form>
          ) : null}

          <div className="flex flex-col gap-0.5">
            {labels.length === 0 ? (
              <p className="px-4 py-1 text-[11px] text-muted">{t('labels.empty')}</p>
            ) : null}
            {labels.map((label) => {
              const active = selectedLabelId === label.id
              if (editingId === label.id) {
                return (
                  <form
                    key={label.id}
                    onSubmit={(event) => void saveEdit(event, label)}
                    className="mb-1 rounded-xl border border-line bg-white p-2"
                  >
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      placeholder={t('labels.name')}
                      maxLength={40}
                      autoFocus
                      className="w-full rounded-lg border border-line px-2 py-1.5 text-xs outline-none focus:border-brand"
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {LABEL_COLORS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setEditColor(item.id)}
                          aria-label={item.id}
                          className={cn(
                            'h-4 w-4 rounded-full ring-offset-1',
                            item.dot,
                            editColor === item.id ? 'ring-2 ring-slate-700' : '',
                          )}
                        />
                      ))}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="submit"
                        disabled={editBusy || !editName.trim()}
                        className="flex-1 rounded-lg bg-slate-900 px-2 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        {editBusy ? t('common.loading') : t('common.save')}
                      </button>
                      <button
                        type="button"
                        disabled={editBusy}
                        onClick={cancelEdit}
                        className="rounded-lg border border-line px-2 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </form>
                )
              }
              return (
                <div
                  key={label.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-full pr-2',
                    active ? labelStyle(label.color) : 'text-slate-700 hover:bg-slate-200/60',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectLabel(label.id)
                      onClose()
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-full px-4 py-2 text-left text-sm"
                  >
                    <span className={cn('h-3 w-3 shrink-0 rounded-sm', labelDot(label.color))} />
                    <span className="truncate">{label.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(label)}
                    title={t('labels.edit', { name: label.name })}
                    aria-label={t('labels.edit', { name: label.name })}
                    className="shrink-0 rounded-full p-1 text-muted opacity-60 hover:bg-white/70 hover:text-slate-900 hover:opacity-100"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteLabel(label.id)}
                    title={t('labels.delete')}
                    aria-label={t('labels.delete', { name: label.name })}
                    className="shrink-0 rounded-full p-1 text-muted opacity-60 hover:bg-white/70 hover:text-brand-strong hover:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-auto rounded-xl border border-line bg-white/70 p-3 text-xs text-muted">
          {account ? (
            <>
              <p className="flex items-center gap-1.5 font-medium text-slate-700">
                {account.kind === 'imap' ? (
                  <Server size={14} />
                ) : account.storageDriver === 'drive' ? (
                  <Cloud size={14} />
                ) : (
                  <HardDrive size={14} />
                )}
                {account.kind === 'imap' ? t('sidebar.imap') : t('sidebar.relay')}
              </p>
              <p className="mt-1 truncate">{account.email}</p>
            </>
          ) : (
            <p className="flex items-center gap-1.5">
              <Tag size={13} />
              {t('sidebar.all')}
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
