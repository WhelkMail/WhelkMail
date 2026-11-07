import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CloudOff, Pencil } from 'lucide-react'
import type {
  Account,
  AccountCreateInput,
  AccountPatch,
  ComposeSeed,
  Contact,
  ContactInput,
  DraftPayload,
  FilterInput,
  Folder,
  HealthStatus,
  Label,
  LabelColor,
  MailFilter,
  MessageDetail,
  MessageSummary,
  SignatureMode,
  StorageOptions,
} from '../shared/types'
import { useI18n } from './i18n'
import { api, ApiError, type AccountError } from './lib/api'
import { errorText } from './lib/errors'
import { displayAddress } from './lib/utils'
import { Compose } from './components/Compose'
import { Contacts } from './components/Contacts'
import { Login } from './components/Login'
import { MailList } from './components/MailList'
import { Onboarding } from './components/Onboarding'
import { ReadingPane } from './components/ReadingPane'
import { Settings } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'

type View = 'mail' | 'settings' | 'contacts'
type AuthState = 'loading' | 'needed' | 'ok'

export default function App() {
  const { t } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })
  const [auth, setAuth] = useState<AuthState>('loading')
  const [fatal, setFatal] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [filters, setFilters] = useState<MailFilter[]>([])
  const [defaultSignature, setDefaultSignature] = useState('')
  const [signatureMode, setSignatureMode] = useState<SignatureMode>('shared')
  const [storage, setStorage] = useState<StorageOptions>({ drive: true, r2: false })
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null)
  const [folder, setFolder] = useState<Folder>('inbox')
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [listErrors, setListErrors] = useState<AccountError[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hiddenIds, setHiddenIds] = useState<string[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [view, setView] = useState<View>('mail')
  const [query, setQuery] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [addingAccount, setAddingAccount] = useState(false)
  const [readingPane, setReadingPane] = useState(() => {
    try {
      return localStorage.getItem('mc_reading_pane') === '1'
    } catch {
      return false
    }
  })
  const [defaultSenderNew, setDefaultSenderNew] = useState<string>(() => {
    try {
      return (
        localStorage.getItem('mc_default_sender_new') ||
        localStorage.getItem('mc_default_sender') ||
        'auto'
      )
    } catch {
      return 'auto'
    }
  })
  const [defaultSenderReply, setDefaultSenderReply] = useState<string>(() => {
    try {
      return (
        localStorage.getItem('mc_default_sender_reply') ||
        localStorage.getItem('mc_default_sender') ||
        'auto'
      )
    } catch {
      return 'auto'
    }
  })
  const [composeDraft, setComposeDraft] = useState<DraftPayload | null>(null)
  const [composeSeed, setComposeSeed] = useState<ComposeSeed | null>(null)
  const [composeKey, setComposeKey] = useState(0)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [syncingMessages, setSyncingMessages] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const syncRefreshCount = useRef(0)
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [settingsBusyId, setSettingsBusyId] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const selectedAccount = accounts.find((item) => item.id === selectedAccountId) ?? null
  const selectedLabel = labels.find((item) => item.id === selectedLabelId) ?? null

  const load = useCallback(async () => {
    setAuth('loading')
    setFatal(null)
    try {
      const [accountsResponse, storageResponse, healthResponse] = await Promise.all([
        api.accounts(),
        api.storageOptions(),
        api.health(),
      ])
      setAccounts(accountsResponse.accounts)
      setStorage(storageResponse)
      setHealth(healthResponse)
      try {
        const labelsResponse = await api.labels()
        setLabels(labelsResponse.labels)
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) {
          throw error
        }
      }
      try {
        const settingsResponse = await api.settings()
        setDefaultSignature(settingsResponse.defaultSignature)
        setSignatureMode(settingsResponse.signatureMode)
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) {
          throw error
        }
      }
      try {
        const filtersResponse = await api.filters()
        setFilters(filtersResponse.filters)
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) {
          throw error
        }
      }
      try {
        const contactsResponse = await api.contacts()
        setContacts(contactsResponse.contacts)
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) {
          throw error
        }
      }
      setAuth('ok')
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setAuth('needed')
        return
      }
      setFatal(error instanceof Error ? error.message : 'Loading error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const oauth = params.get('microsoft') ?? params.get('google') ?? params.get('drive')
    if (!oauth) {
      return
    }
    if (oauth === 'connected') {
      if (params.get('google')) {
        setNotice(t('app.googleConnected'))
      } else if (params.get('microsoft')) {
        setNotice(t('app.microsoftConnected'))
      } else {
        setNotice(t('app.driveConnected'))
      }
    } else {
      setNotice(t('app.connectFailed', { reason: params.get('reason') ?? 'error' }))
    }
    const accountId = params.get('account')
    if (accountId) {
      setSelectedAccountId(accountId)
    }
    params.delete('microsoft')
    params.delete('google')
    params.delete('drive')
    params.delete('reason')
    params.delete('account')
    const search = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${search ? `?${search}` : ''}`)
  }, [t])

  useEffect(() => {
    syncRefreshCount.current = 0
  }, [selectedAccountId, folder, selectedLabelId])

  useEffect(() => {
    if (auth !== 'ok') {
      return
    }
    let cancelled = false
    setLoadingMessages(true)
    api
      .messages(selectedAccountId, folder, selectedLabelId)
      .then((response) => {
        if (cancelled) {
          return
        }
        setMessages(response.messages)
        setListErrors(response.errors)
        setSyncingMessages(Boolean(response.syncing))
        setSelectedIds((current) =>
          current.filter((id) => response.messages.some((item) => item.id === id)),
        )
        setHiddenIds((current) =>
          current.filter((id) => response.messages.some((item) => item.id === id)),
        )
        setSelectedMessageId((current) =>
          current && response.messages.some((item) => item.id === current) ? current : null,
        )
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        setSyncingMessages(false)
        if (error instanceof ApiError && error.isUnauthorized) {
          setAuth('needed')
          return
        }
        setSettingsError(errorText(error, tRef.current))
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingMessages(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [auth, selectedAccountId, folder, selectedLabelId, refreshKey])

  useEffect(() => {
    if (!syncingMessages) {
      syncRefreshCount.current = 0
      return
    }
    if (syncRefreshCount.current >= 20) {
      return
    }
    const timer = window.setTimeout(() => {
      syncRefreshCount.current += 1
      setRefreshKey((key) => key + 1)
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [syncingMessages, refreshKey])

  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (accounts.length === 0) {
      return
    }
    const ids = new Set(accounts.map((account) => account.id))
    if (defaultSenderNew !== 'auto' && !ids.has(defaultSenderNew)) {
      setDefaultSenderNew('auto')
      try {
        localStorage.setItem('mc_default_sender_new', 'auto')
      } catch {
        // ignore
      }
    }
    if (defaultSenderReply !== 'auto' && !ids.has(defaultSenderReply)) {
      setDefaultSenderReply('auto')
      try {
        localStorage.setItem('mc_default_sender_reply', 'auto')
      } catch {
        // ignore
      }
    }
  }, [accounts, defaultSenderNew, defaultSenderReply])

  useEffect(() => {
    if (!selectedMessageId || auth !== 'ok') {
      setDetail(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    api
      .message(selectedMessageId)
      .then((response) => {
        if (!cancelled) {
          setDetail(response.message)
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        if (error instanceof ApiError && error.isUnauthorized) {
          setAuth('needed')
          return
        }
        setDetailError(errorText(error, tRef.current))
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedMessageId, auth])

  const visibleMessages = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let result = messages
    if (hiddenIds.length > 0) {
      result = result.filter((message) => !hiddenIds.includes(message.id))
    }
    if (needle) {
      result = result.filter((message) => {
        const haystack = [
          message.subject,
          message.snippet,
          message.accountEmail,
          message.from.name ?? '',
          message.from.email,
          ...message.to.map((item) => `${item.name ?? ''} ${item.email}`),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.includes(needle)
      })
    }
    if (selectedLabelId) {
      result = result.filter((message) => message.labelIds.includes(selectedLabelId))
    }
    return result
  }, [messages, query, selectedLabelId, hiddenIds])

  function openCompose(draft: DraftPayload | null, seed: ComposeSeed | null = null) {
    setComposeDraft(draft)
    setComposeSeed(seed)
    setComposeKey((key) => key + 1)
    setComposeOpen(true)
  }

  function replyTo(message: MessageDetail, all: boolean) {
    const sendingAccountId =
      defaultSenderReply !== 'auto' &&
      accounts.some((account) => account.id === defaultSenderReply)
        ? defaultSenderReply
        : message.accountId
    const sendingAccount = accounts.find((account) => account.id === sendingAccountId)
    const ownAddresses = new Set(
      [message.accountEmail, sendingAccount?.email ?? '']
        .filter(Boolean)
        .map((email) => email.toLowerCase()),
    )
    const normalize = (values: string[]): string[] => {
      const seen = new Set<string>()
      const result: string[] = []
      for (const value of values) {
        const email = value.trim()
        const key = email.toLowerCase()
        if (!email || ownAddresses.has(key) || seen.has(key)) {
          continue
        }
        seen.add(key)
        result.push(email)
      }
      return result
    }
    const baseTargets =
      message.folder === 'sent'
        ? message.to.map((item) => item.email)
        : [message.from.email]
    const to = normalize(
      all ? [...baseTargets, ...message.to.map((item) => item.email)] : baseTargets,
    )
    const cc = all
      ? normalize(message.cc.map((item) => item.email)).filter(
          (email) => !to.some((item) => item.toLowerCase() === email.toLowerCase()),
        )
      : []
    const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`
    const quoted = message.text
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join('\n')
    const text = `\n\nOn ${new Date(message.date).toLocaleString()}, ${displayAddress(
      message.from,
    )} wrote:\n${quoted}`
    openCompose(null, {
      accountId: sendingAccountId,
      to,
      cc,
      bcc: [],
      subject,
      text,
    })
  }

  async function selectMessage(id: string) {
    const summary = messages.find((item) => item.id === id)
    if ((summary?.folder ?? folder) === 'draft') {
      try {
        const response = await api.draft(id)
        openCompose(response.draft)
      } catch (error) {
        setSettingsError(errorText(error, t))
      }
      return
    }
    setSelectedMessageId(id)
    setMessages((current) => current.map((item) => (item.id === id ? { ...item, unread: false } : item)))
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds((current) =>
      ids.length > 0 && ids.every((id) => current.includes(id)) ? [] : ids,
    )
  }

  async function runMessageAction(
    ids: string[],
    action: 'delete' | 'spam' | 'move',
    target?: 'inbox' | 'spam' | 'trash',
  ): Promise<void> {
    if (ids.length === 0 || actionBusy) {
      return
    }
    setActionBusy(true)
    try {
      const result = await api.messageAction(ids, action, target)
      if (result.errors.length > 0) {
        setNotice(result.errors.map((item) => item.message).join('; '))
      }
      const failed = new Set(result.errors.flatMap((item) => item.ids))
      const skipped = new Set(result.skipped)
      const succeeded = ids.filter((id) => !failed.has(id) && !skipped.has(id))
      const deletesMessage = action === 'delete' || (action === 'move' && target === 'trash')
      if (deletesMessage) {
        setMessages((current) => current.filter((item) => !succeeded.includes(item.id)))
      } else if (succeeded.length > 0) {
        setHiddenIds((current) => [...new Set([...current, ...succeeded])])
      }
      if (selectedMessageId && succeeded.includes(selectedMessageId)) {
        setSelectedMessageId(null)
        setDetail(null)
      }
      setSelectedIds([])
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setNotice(errorText(error, tRef.current))
    } finally {
      setActionBusy(false)
    }
  }

  async function createAccount(input: AccountCreateInput): Promise<Account | null> {
    setOnboardingBusy(true)
    setOnboardingError(null)
    try {
      const response = await api.createAccount(input)
      setAccounts((current) => [...current, response.account])
      setSelectedAccountId(response.account.id)
      setSelectedLabelId(null)
      setAddingAccount(false)
      setView('mail')
      setNotice(input.kind === 'imap' ? t('app.accountCreatedTest') : t('app.accountCreated'))
      setRefreshKey((key) => key + 1)
      try {
        const labelsResponse = await api.labels()
        setLabels(labelsResponse.labels)
      } catch {
        // labels require the latest schema; the account is still usable
      }
      return response.account
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setAuth('needed')
        return null
      }
      setOnboardingError(errorText(error, t))
      return null
    } finally {
      setOnboardingBusy(false)
    }
  }

  async function updateAccount(id: string, patch: AccountPatch) {
    setSettingsBusyId(id)
    setSettingsError(null)
    try {
      const response = await api.updateAccount(id, patch)
      setAccounts((current) => current.map((item) => (item.id === id ? response.account : item)))
      setNotice(t('app.accountUpdated'))
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setSettingsError(errorText(error, t))
    } finally {
      setSettingsBusyId(null)
    }
  }

  async function testAccount(id: string) {
    setSettingsBusyId(id)
    setSettingsError(null)
    try {
      const response = await api.testAccount(id)
      const checks = response.checks
        ? Object.entries(response.checks).map(([key, value]) => `${key}: ${value}`)
        : []
      setNotice(
        checks.length > 0
          ? t('app.connectionOk', { checks: checks.join(' · ') })
          : t('app.connectionOk', { checks: 'OK' }),
      )
    } catch (error) {
      setSettingsError(errorText(error, t))
    } finally {
      setSettingsBusyId(null)
    }
  }

  async function deleteAccount(id: string) {
    const account = accounts.find((item) => item.id === id)
    if (!window.confirm(t('settings.deleteConfirm', { email: account?.email ?? '' }))) {
      return
    }
    setSettingsBusyId(id)
    setSettingsError(null)
    try {
      await api.deleteAccount(id)
      setAccounts((current) => current.filter((item) => item.id !== id))
      if (selectedAccountId === id) {
        setSelectedAccountId('all')
      }
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setSettingsError(errorText(error, t))
    } finally {
      setSettingsBusyId(null)
    }
  }

  async function createLabel(name: string, color: LabelColor): Promise<Label | null> {
    try {
      const response = await api.createLabel({ name, color })
      setLabels((current) => [...current, response.label])
      return response.label
    } catch (error) {
      setNotice(errorText(error, tRef.current))
      return null
    }
  }

  async function deleteLabel(id: string) {
    const label = labels.find((item) => item.id === id)
    if (!label || !window.confirm(t('labels.deleteConfirm', { name: label.name }))) {
      return
    }
    try {
      await api.deleteLabel(id)
      setLabels((current) => current.filter((item) => item.id !== id))
      setAccounts((current) =>
        current.map((item) =>
          item.incomingLabelId === id ? { ...item, incomingLabelId: null } : item,
        ),
      )
      setFilters((current) =>
        current.flatMap((item) => {
          if (!item.labelIds.includes(id)) {
            return [item]
          }
          const labelIds = item.labelIds.filter((labelId) => labelId !== id)
          return labelIds.length > 0 ? [{ ...item, labelIds }] : []
        }),
      )
      setMessages((current) =>
        current.map((message) => ({
          ...message,
          labelIds: message.labelIds.filter((labelId) => labelId !== id),
        })),
      )
      setDetail((current) =>
        current
          ? { ...current, labelIds: current.labelIds.filter((labelId) => labelId !== id) }
          : current,
      )
      if (selectedLabelId === id) {
        setSelectedLabelId(null)
      }
    } catch (error) {
      setNotice(errorText(error, tRef.current))
    }
  }

  async function createFilter(input: FilterInput) {
    try {
      const response = await api.createFilter(input)
      setFilters((current) => [...current, response.filter])
      setNotice(t('filters.created'))
      setRefreshKey((key) => key + 1)
      return true
    } catch (error) {
      setSettingsError(errorText(error, t))
      return false
    }
  }

  async function updateFilter(id: string, input: FilterInput) {
    try {
      const response = await api.updateFilter(id, input)
      setFilters((current) =>
        current.map((item) => (item.id === id ? response.filter : item)),
      )
      setNotice(t('filters.updated'))
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setSettingsError(errorText(error, t))
    }
  }

  async function deleteFilter(id: string) {
    const filter = filters.find((item) => item.id === id)
    if (!filter || !window.confirm(t('filters.deleteConfirm', { name: filter.name }))) {
      return
    }
    try {
      await api.deleteFilter(id)
      setFilters((current) => current.filter((item) => item.id !== id))
      setNotice(t('filters.deleted'))
    } catch (error) {
      setSettingsError(errorText(error, t))
    }
  }

  function sortContacts(items: Contact[]): Contact[] {
    return [...items].sort((left, right) => left.name.localeCompare(right.name))
  }

  async function createContact(input: ContactInput): Promise<Contact | null> {
    try {
      const response = await api.createContact(input)
      setContacts((current) => {
        const exists = current.some((item) => item.id === response.contact.id)
        return sortContacts(
          exists
            ? current.map((item) => (item.id === response.contact.id ? response.contact : item))
            : [...current, response.contact],
        )
      })
      return response.contact
    } catch (error) {
      setSettingsError(errorText(error, t))
      return null
    }
  }

  async function updateContact(id: string, input: ContactInput): Promise<boolean> {
    try {
      const response = await api.updateContact(id, input)
      setContacts((current) =>
        sortContacts(current.map((item) => (item.id === id ? response.contact : item))),
      )
      return true
    } catch (error) {
      setSettingsError(errorText(error, t))
      return false
    }
  }

  async function deleteContact(id: string) {
    const contact = contacts.find((item) => item.id === id)
    if (!contact || !window.confirm(t('contacts.deleteConfirm', { name: contact.name }))) {
      return
    }
    try {
      await api.deleteContact(id)
      setContacts((current) => current.filter((item) => item.id !== id))
    } catch (error) {
      setSettingsError(errorText(error, t))
    }
  }

  async function setMessageLabels(id: string, labelIds: string[]) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, labelIds } : message)),
    )
    setDetail((current) => (current && current.id === id ? { ...current, labelIds } : current))
    try {
      await api.setMessageLabels(id, labelIds)
    } catch (error) {
      setNotice(errorText(error, tRef.current))
      setRefreshKey((key) => key + 1)
    }
  }

  async function changeDefaultSignature(value: string) {
    setDefaultSignature(value)
    try {
      await api.updateSettings({ defaultSignature: value })
    } catch (error) {
      setSettingsError(errorText(error, t))
    }
  }

  async function changeSignatureMode(value: SignatureMode) {
    setSignatureMode(value)
    try {
      await api.updateSettings({ signatureMode: value })
    } catch (error) {
      setSettingsError(errorText(error, t))
    }
  }

  async function logout() {
    try {
      await api.logout()
    } finally {
      setAccounts([])
      setMessages([])
      setDetail(null)
      setSelectedMessageId(null)
      setSelectedIds([])
      setHiddenIds([])
      setAuth('needed')
    }
  }

  function openFolder(next: Folder) {
    setFolder(next)
    setSelectedLabelId(null)
    setView('mail')
    setSelectedMessageId(null)
    setDetail(null)
    setSelectedIds([])
    setHiddenIds([])
    setQuery('')
  }

  function selectLabel(id: string | null) {
    setSelectedLabelId(id)
    setView('mail')
    setSelectedMessageId(null)
    setDetail(null)
    setSelectedIds([])
    setHiddenIds([])
    setQuery('')
  }

  function changeReadingPane(value: boolean) {
    setReadingPane(value)
    try {
      localStorage.setItem('mc_reading_pane', value ? '1' : '0')
    } catch {
      // ignore
    }
  }

  function changeDefaultSenderNew(value: string) {
    setDefaultSenderNew(value)
    try {
      localStorage.setItem('mc_default_sender_new', value)
    } catch {
      // ignore
    }
  }

  function changeDefaultSenderReply(value: string) {
    setDefaultSenderReply(value)
    try {
      localStorage.setItem('mc_default_sender_reply', value)
    } catch {
      // ignore
    }
  }

  const composeAccountId =
    defaultSenderNew !== 'auto' &&
    accounts.some((account) => account.id === defaultSenderNew)
      ? defaultSenderNew
      : selectedAccountId !== 'all'
        ? selectedAccountId
        : accounts[0]?.id ?? null

  if (auth === 'loading') {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-muted">
        {t('common.loading')}
      </div>
    )
  }

  if (fatal) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <AlertCircle size={32} className="text-brand" />
        <p className="text-sm text-slate-700">{fatal}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-strong"
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (auth === 'needed') {
    return <Login onSuccess={() => void load()} />
  }

  if (accounts.length === 0 || addingAccount) {
    return (
      <Onboarding
        storage={storage}
        health={health}
        busy={onboardingBusy}
        error={onboardingError}
        onCancel={
          accounts.length > 0
            ? () => {
                setAddingAccount(false)
                setOnboardingError(null)
              }
            : undefined
        }
        onCreate={createAccount}
      />
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar
        account={selectedAccount}
        view={view}
        folder={folder}
        labels={labels}
        selectedLabelId={selectedLabelId}
        mobileOpen={mobileSidebarOpen}
        onCompose={() => openCompose(null)}
        onFolder={openFolder}
        onSelectLabel={selectLabel}
        onCreateLabel={createLabel}
        onDeleteLabel={(id) => void deleteLabel(id)}
        onSettings={() => setView('settings')}
        onContacts={() => setView('contacts')}
        onAddAccount={() => {
          setOnboardingError(null)
          setAddingAccount(true)
        }}
        onClose={() => setMobileSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          query={query}
          onSelectAccount={(id) => {
            setSelectedAccountId(id)
            setSelectedLabelId(null)
            setSelectedMessageId(null)
            setDetail(null)
            setSelectedIds([])
            setHiddenIds([])
          }}
          onQuery={(value) => {
            setQuery(value)
            setSelectedIds([])
          }}
          onOpenSettings={() => setView('settings')}
          onLogout={() => void logout()}
          onMenu={() => setMobileSidebarOpen(true)}
        />

        {view === 'mail' && listErrors.length > 0 ? (
          <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
            {listErrors.map((error) => (
              <p key={error.accountId}>
                {error.email}: {error.message}
              </p>
            ))}
          </div>
        ) : null}

        {view === 'mail' &&
        selectedAccount?.kind === 'relay' &&
        selectedAccount.storageDriver === 'drive' &&
        !selectedAccount.driveConnected ? (
          <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
            <span className="flex items-center gap-2">
              <CloudOff size={15} />
              {t('compose.driveNotConnected')}
            </span>
            <a
              href={api.driveConnectUrl(selectedAccount.id)}
              className="rounded-lg bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-700"
            >
              {t('settings.connectDrive')}
            </a>
          </div>
        ) : null}

        {view === 'settings' ? (
          <Settings
            accounts={accounts}
            labels={labels}
            filters={filters}
            storage={storage}
            health={health}
            busyId={settingsBusyId}
            error={settingsError}
            onCreateFilter={createFilter}
            onUpdateFilter={(id, input) => void updateFilter(id, input)}
            onDeleteFilter={(id) => void deleteFilter(id)}
            onCreateLabel={createLabel}
            onUpdate={updateAccount}
            onTest={testAccount}
            onDelete={deleteAccount}
            onConnectDrive={(id) => {
              window.location.href = api.driveConnectUrl(id)
            }}
            onConnectOAuth={(id, provider) => {
              window.location.href =
                provider === 'google'
                  ? api.googleConnectUrl(id)
                  : api.microsoftConnectUrl(id)
            }}
            onAddAccount={() => {
              setOnboardingError(null)
              setAddingAccount(true)
            }}
            readingPane={readingPane}
            onReadingPaneChange={changeReadingPane}
            defaultSenderNew={defaultSenderNew}
            onDefaultSenderNewChange={changeDefaultSenderNew}
            defaultSenderReply={defaultSenderReply}
            onDefaultSenderReplyChange={changeDefaultSenderReply}
            defaultSignature={defaultSignature}
            onDefaultSignatureChange={(value) => void changeDefaultSignature(value)}
            signatureMode={signatureMode}
            onSignatureModeChange={(value) => void changeSignatureMode(value)}
            onSyncComplete={() => setRefreshKey((key) => key + 1)}
            onLogout={() => void logout()}
          />
        ) : view === 'contacts' ? (
          <Contacts
            contacts={contacts}
            onCreate={createContact}
            onUpdate={updateContact}
            onDelete={(id) => void deleteContact(id)}
          />
        ) : (
          <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 overflow-hidden px-0 pb-0 sm:px-4 sm:pb-2 lg:px-6 lg:pb-3">
            {readingPane ? (
              <>
                <MailList
                  messages={visibleMessages}
                  labels={labels}
                  selectedId={selectedMessageId}
                  loading={loadingMessages}
                  syncing={syncingMessages}
                  folder={folder}
                  labelName={selectedLabel?.name ?? null}
                  className={selectedMessageId ? 'hidden md:flex' : ''}
                  selectedIds={selectedIds}
                  actionBusy={actionBusy}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={toggleSelectAll}
                  onAction={(action, target) =>
                    void runMessageAction(selectedIds, action, target)
                  }
                  onSelect={(id) => void selectMessage(id)}
                />
                <ReadingPane
                  message={detail}
                  labels={labels}
                  loading={detailLoading}
                  error={detailError}
                  rawUrl={selectedMessageId ? api.rawUrl(selectedMessageId) : null}
                  attachmentUrl={(index) =>
                    selectedMessageId ? api.attachmentUrl(selectedMessageId, index) : '#'
                  }
                  onBack={() => {
                    setSelectedMessageId(null)
                    setDetail(null)
                  }}
                  onReply={(all) => {
                    if (detail) {
                      replyTo(detail, all)
                    }
                  }}
                  onSetLabels={(ids) => {
                    if (detail) {
                      void setMessageLabels(detail.id, ids)
                    }
                  }}
                  actionBusy={actionBusy}
                  onDelete={() => {
                    if (detail) {
                      void runMessageAction([detail.id], 'delete')
                    }
                  }}
                  onToggleSpam={() => {
                    if (!detail) {
                      return
                    }
                    void runMessageAction(
                      [detail.id],
                      detail.folder === 'spam' ? 'move' : 'spam',
                      detail.folder === 'spam' ? 'inbox' : undefined,
                    )
                  }}
                />
              </>
            ) : selectedMessageId ? (
              <ReadingPane
                message={detail}
                labels={labels}
                loading={detailLoading}
                error={detailError}
                rawUrl={api.rawUrl(selectedMessageId)}
                attachmentUrl={(index) => api.attachmentUrl(selectedMessageId, index)}
                onBack={() => {
                  setSelectedMessageId(null)
                  setDetail(null)
                }}
                onReply={(all) => {
                  if (detail) {
                    replyTo(detail, all)
                  }
                }}
                onSetLabels={(ids) => {
                  if (detail) {
                    void setMessageLabels(detail.id, ids)
                  }
                }}
                actionBusy={actionBusy}
                onDelete={() => {
                  if (detail) {
                    void runMessageAction([detail.id], 'delete')
                  }
                }}
                onToggleSpam={() => {
                  if (!detail) {
                    return
                  }
                  void runMessageAction(
                    [detail.id],
                    detail.folder === 'spam' ? 'move' : 'spam',
                    detail.folder === 'spam' ? 'inbox' : undefined,
                  )
                }}
              />
            ) : (
              <MailList
                messages={visibleMessages}
                labels={labels}
                selectedId={selectedMessageId}
                loading={loadingMessages}
                syncing={syncingMessages}
                folder={folder}
                labelName={selectedLabel?.name ?? null}
                fullWidth
                selectedIds={selectedIds}
                actionBusy={actionBusy}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onAction={(action, target) =>
                  void runMessageAction(selectedIds, action, target)
                }
                onSelect={(id) => void selectMessage(id)}
              />
            )}
          </div>
        )}
      </div>

      {view === 'mail' && !composeOpen && !selectedMessageId ? (
        <button
          type="button"
          onClick={() => openCompose(null)}
          aria-label={t('sidebar.compose')}
          title={t('sidebar.compose')}
          className="fixed bottom-6 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-xl transition hover:bg-brand-strong md:hidden"
        >
          <Pencil size={24} />
        </button>
      ) : null}

      {composeOpen ? (
        <Compose
          key={composeKey}
          accounts={accounts}
          contacts={contacts}
          defaultAccountId={composeAccountId}
          defaultSignature={defaultSignature}
          signatureMode={signatureMode}
          maxAttachmentBytes={health?.maxAttachmentBytes ?? 15 * 1024 * 1024}
          initialDraft={composeDraft}
          seed={composeSeed}
          onClose={() => {
            setComposeOpen(false)
            setComposeDraft(null)
            setComposeSeed(null)
            setRefreshKey((key) => key + 1)
          }}
          onSent={(warning, sentFolder) => {
            setComposeOpen(false)
            setComposeDraft(null)
            setComposeSeed(null)
            setFolder('sent')
            setView('mail')
            setQuery('')
            setSelectedMessageId(null)
            setRefreshKey((key) => key + 1)
            setNotice(
              warning ??
                (sentFolder
                  ? t('app.emailSentInFolder', { folder: sentFolder })
                  : t('app.emailSent')),
            )
          }}
          onSaved={() => {
            setComposeOpen(false)
            setComposeDraft(null)
            setComposeSeed(null)
            setFolder('draft')
            setView('mail')
            setQuery('')
            setSelectedMessageId(null)
            setRefreshKey((key) => key + 1)
            setNotice(t('app.draftSaved'))
          }}
          onDeleted={() => {
            setComposeOpen(false)
            setComposeDraft(null)
            setComposeSeed(null)
            setFolder('draft')
            setView('mail')
            setSelectedMessageId(null)
            setRefreshKey((key) => key + 1)
            setNotice(t('app.draftDeleted'))
          }}
        />
      ) : null}

      {notice ? (
        <div className="fixed bottom-6 left-1/2 z-[60] max-w-lg -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-center text-xs text-white shadow-lg">
          {notice}
        </div>
      ) : null}
    </div>
  )
}
