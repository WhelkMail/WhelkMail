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
  MailThread,
  LabelInput,
  LabelColor,
  MailFilter,
  MessageDetail,
  MessageSummary,
  SearchScope,
  SignatureMode,
  StorageOptions,
} from '../shared/types'
import { useI18n } from './i18n'
import { api, ApiError, type AccountError } from './lib/api'
import { nextChainDelay, runSyncChain } from './lib/sync-chain'
import { pickSyncRequests } from './lib/sync-queue'
import { errorText } from './lib/errors'
import { syncSignature } from './lib/sync-signature'
import { mergePage } from '../shared/paging'
import { pickReplySender } from './lib/sender'
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

interface MailRoute {
  view: View
  folder: Folder
  labelId: string | null
  messageId: string | null
  accountId: string
}

const FOLDER_PATHS: Record<Folder, string> = {
  inbox: 'inbox',
  sent: 'sent',
  draft: 'drafts',
  spam: 'spam',
}

const PATH_FOLDERS: Record<string, Folder> = {
  inbox: 'inbox',
  sent: 'sent',
  drafts: 'draft',
  draft: 'draft',
  spam: 'spam',
}

function parseRoute(): MailRoute {
  const accountId = new URLSearchParams(window.location.search).get('account') ?? 'all'
  const segments = window.location.pathname.split('/').filter(Boolean)
  const head = segments[0] ?? ''
  if (head === 'settings') {
    return { view: 'settings', folder: 'inbox', labelId: null, messageId: null, accountId }
  }
  if (head === 'contacts') {
    return { view: 'contacts', folder: 'inbox', labelId: null, messageId: null, accountId }
  }
  if (head === 'label' && segments[1]) {
    return {
      view: 'mail',
      folder: 'inbox',
      labelId: decodeURIComponent(segments[1]),
      messageId: segments[2] ? decodeURIComponent(segments[2]) : null,
      accountId,
    }
  }
  return {
    view: 'mail',
    folder: PATH_FOLDERS[head] ?? 'inbox',
    labelId: null,
    messageId: segments[1] ? decodeURIComponent(segments[1]) : null,
    accountId,
  }
}

function routeUrl(route: MailRoute): string {
  const params = new URLSearchParams()
  if (route.accountId !== 'all') {
    params.set('account', route.accountId)
  }
  const suffix = params.toString() ? `?${params.toString()}` : ''
  if (route.view === 'settings') {
    return `/settings${suffix}`
  }
  if (route.view === 'contacts') {
    return `/contacts${suffix}`
  }
  if (route.labelId) {
    const base = `/label/${encodeURIComponent(route.labelId)}`
    return route.messageId
      ? `${base}/${encodeURIComponent(route.messageId)}${suffix}`
      : `${base}${suffix}`
  }
  const base = `/${FOLDER_PATHS[route.folder]}`
  return route.messageId ? `${base}/${encodeURIComponent(route.messageId)}${suffix}` : `${base}${suffix}`
}

export default function App() {
  const { t } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  })
  const [initialRoute] = useState<MailRoute>(() => parseRoute())
  const [auth, setAuth] = useState<AuthState>('loading')
  const [fatal, setFatal] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [filters, setFilters] = useState<MailFilter[]>([])
  const [defaultSignature, setDefaultSignature] = useState('')
  const [signatureMode, setSignatureMode] = useState<SignatureMode>('shared')
  const [allowRemoteImages, setAllowRemoteImages] = useState(false)
  const [metadataRetentionDays, setMetadataRetentionDays] = useState(0)
  const [storage, setStorage] = useState<StorageOptions>({ drive: true, r2: false })
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>(initialRoute.accountId)
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(initialRoute.labelId)
  const [folder, setFolder] = useState<Folder>(initialRoute.folder)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [listErrors, setListErrors] = useState<AccountError[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [hiddenIds, setHiddenIds] = useState<string[]>([])
  const [actionBusy, setActionBusy] = useState(false)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(initialRoute.messageId)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [threadMessages, setThreadMessages] = useState<MessageSummary[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailSwitching, setDetailSwitching] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [view, setView] = useState<View>(initialRoute.view)
  const [query, setQuery] = useState('')
  const [searchScope, setSearchScope] = useState<SearchScope>('all')
  const [searchResults, setSearchResults] = useState<MessageSummary[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [searchCursor, setSearchCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchContacts, setSearchContacts] = useState<Contact[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
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
  const [listLoaded, setListLoaded] = useState(false)
  const [pendingSync, setPendingSync] = useState<{ stale: string[]; active: string[] } | null>(null)
  const syncRequestsRef = useRef<Record<string, number>>({})
  /** Folders whose chain is running, so one folder never runs two chains. */
  const syncChainsRef = useRef<Set<string>>(new Set())
  const [syncingMessages, setSyncingMessages] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const syncSignatureRef = useRef('')
  const composeHistoryRef = useRef(false)
  const [onboardingBusy, setOnboardingBusy] = useState(false)
  const [onboardingError, setOnboardingError] = useState<string | null>(null)
  const [settingsBusyId, setSettingsBusyId] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const routeUrlRef = useRef<string | null>(null)

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
      const optional = async <T,>(promise: Promise<T>): Promise<T | null> => {
        try {
          return await promise
        } catch (error) {
          if (error instanceof ApiError && error.isUnauthorized) {
            throw error
          }
          return null
        }
      }
      const [labelsResponse, settingsResponse, filtersResponse, contactsResponse] =
        await Promise.all([
          optional(api.labels()),
          optional(api.settings()),
          optional(api.filters()),
          optional(api.contacts()),
        ])
      if (labelsResponse) {
        setLabels(labelsResponse.labels)
      }
      if (settingsResponse) {
        setDefaultSignature(settingsResponse.defaultSignature)
        setSignatureMode(settingsResponse.signatureMode)
        setAllowRemoteImages(settingsResponse.allowRemoteImages)
        setMetadataRetentionDays(settingsResponse.metadataRetentionDays)
      }
      if (filtersResponse) {
        setFilters(filtersResponse.filters)
      }
      if (contactsResponse) {
        setContacts(contactsResponse.contacts)
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
    const next = routeUrl({
      view,
      folder,
      labelId: selectedLabelId,
      messageId: selectedMessageId,
      accountId: selectedAccountId,
    })
    const previous = routeUrlRef.current
    routeUrlRef.current = next
    const current = `${window.location.pathname}${window.location.search}`
    if (next === current) {
      return
    }
    if (previous === null) {
      window.history.replaceState({}, '', next)
    } else {
      window.history.pushState({}, '', next)
    }
  }, [view, folder, selectedLabelId, selectedMessageId, selectedAccountId])

  useEffect(() => {
    function onPopState() {
      const route = parseRoute()
      routeUrlRef.current = `${window.location.pathname}${window.location.search}`
      setView(route.view)
      setFolder(route.folder)
      setSelectedLabelId(route.labelId)
      setSelectedMessageId(route.messageId)
      setSelectedAccountId(route.accountId)
      setSelectedIds([])
      setHiddenIds([])
      setQuery('')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    syncSignatureRef.current = ''
    setListLoaded(false)
    setMessages([])
    setNextCursor(null)
    setSelectedIds([])
    setHiddenIds([])
  }, [selectedAccountId, folder, selectedLabelId])

  useEffect(() => {
    if (auth !== 'ok') {
      return
    }
    // Settings and Contacts do not need the mail list: fetching it there was pure
    // load (and could compete with the panels' requests).
    if (view !== 'mail') {
      return
    }
    let cancelled = false
    const requestStartedAt = performance.now()
    console.log(
      `[list] start folder=${folder} account=${selectedAccountId} label=${selectedLabelId ?? '-'} refresh=${refreshKey} view=${view}`,
    )
    const request = api
      .threads({ accountId: selectedAccountId, folder, labelId: selectedLabelId })
      .then((response) => {
        console.log(
          `[list] folder=${folder} account=${selectedAccountId} threads=${response.threads.length} syncing=${Boolean(response.syncing)} ms=${Math.round(performance.now() - requestStartedAt)}`,
        )
        return {
          messages: response.threads.map(threadSummary),
          nextCursor: response.nextCursor,
          errors: response.errors,
          syncing: Boolean(response.syncing),
          stale: response.staleAccounts ?? [],
          active: response.activeAccounts ?? [],
        }
      })
    request
      .then((response) => {
        if (cancelled) {
          return
        }
        setMessages(response.messages)
        setNextCursor(response.nextCursor ?? null)
        setListErrors(response.errors)
        // Only a fresh answer for the folder on screen may schedule syncs: an
        // older response arriving late would use the wrong folder.
        setPendingSync({ stale: response.stale, active: response.active })
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
        console.warn(
          `[list] failed after ${Math.round(performance.now() - requestStartedAt)}ms: ${errorText(error, tRef.current)}`,
        )
        setListErrors([
          {
            accountId: 'list',
            email: selectedAccountId === 'all' ? t('common.allAccounts') : '',
            message: errorText(error, tRef.current),
          },
        ])
      })
      .finally(() => {
        if (!cancelled) {
          setListLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [auth, selectedAccountId, folder, selectedLabelId, refreshKey, view])

  // One chain of sync chunks per stale account: `partial` means there is more to
  // fetch, so the list keeps asking until the folder reports done. The request
  // starts here, after the list is on screen, never on the server.
  /**
   * Run one folder's sync to the end.
   *
   * A chain stops at the cap (or on a lock) with the folder still partial: nobody
   * would come back to it, so another chain is scheduled after a pause. The set
   * keeps one chain per folder, whichever path started it.
   */
  function startSyncChain(accountId: string, target: Folder): void {
    const key = `${accountId}:${target}`
    if (syncChainsRef.current.has(key)) {
      return
    }
    syncChainsRef.current.add(key)
    const finish = () => syncChainsRef.current.delete(key)
    void runSyncChain(() => api.runSync(accountId, target), { max: 30, delayMs: 250 })
      .then((result) => {
        const delay = nextChainDelay(result)
        if (delay === null) {
          finish()
          return
        }
        window.setTimeout(() => {
          syncChainsRef.current.delete(key)
          startSyncChain(accountId, target)
        }, delay)
      })
      .catch(() => finish())
  }

  useEffect(() => {
    if (!pendingSync || !listLoaded || view !== 'mail') {
      return
    }
    const requests = pickSyncRequests({
      stale: pendingSync.stale.map((id) => `${id}:${folder}`),
      active: pendingSync.active.map((id) => `${id}:${folder}`),
      lastRequested: syncRequestsRef.current,
      now: Date.now(),
      limit: 3,
      minAgeMs: 3000,
    })
    if (requests.length === 0) {
      return
    }
    for (const key of requests) {
      syncRequestsRef.current[key] = Date.now()
      const accountId = key.slice(0, key.lastIndexOf(':'))
      // The chain follows hasMore by itself and resumes after the cap: it does not
      // depend on the list being reloaded or on the stale TTL.
      startSyncChain(accountId, folder)
    }
    // The poll refreshes the list while chunks land and once they are done.
    setSyncingMessages(true)
  }, [pendingSync, listLoaded, view, folder])

  useEffect(() => {
    if (!syncingMessages || auth !== 'ok') {
      return
    }
    let cancelled = false
    let timer: number | null = null
    let attempt = 0

    function schedule(delay: number) {
      if (cancelled) {
        return
      }
      timer = window.setTimeout(() => {
        void poll()
      }, delay)
    }

    async function poll() {
      if (cancelled) {
        return
      }
      if (document.visibilityState === 'hidden') {
        schedule(15000)
        return
      }
      try {
        const overview = await api.syncOverview()
        if (cancelled) {
          return
        }
        const signature = syncSignature(overview)
        if (syncSignatureRef.current === '') {
          // First poll only records the state: refreshing here made every return
          // to the list fetch twice for nothing.
          syncSignatureRef.current = signature
        } else if (signature !== syncSignatureRef.current) {
          syncSignatureRef.current = signature
          setRefreshKey((key) => key + 1)
        }
        if (!overview.syncing) {
          // The last batch is already in D1 but the list was rendered before it
          // landed: refresh once more so the final window is never lost.
          setRefreshKey((key) => key + 1)
          setSyncingMessages(false)
          return
        }
        attempt += 1
        schedule(Math.min(15000, 4000 + attempt * 2000))
      } catch (error) {
        if (cancelled) {
          return
        }
        if (error instanceof ApiError && error.isUnauthorized) {
          setAuth('needed')
          return
        }
        attempt += 1
        if (attempt > 20) {
          setSyncingMessages(false)
          return
        }
        schedule(Math.min(30000, 5000 + attempt * 5000))
      }
    }

    function onVisibility() {
      if (document.visibilityState !== 'visible' || cancelled) {
        return
      }
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
      void poll()
    }

    document.addEventListener('visibilitychange', onVisibility)
    schedule(4000)
    return () => {
      cancelled = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [syncingMessages, auth])

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
      setThreadMessages([])
      return
    }
    let cancelled = false
    // Moving inside the same conversation must not blank the pane: keep what is
    // on screen and show a thin progress line until the new body arrives.
    const sameThread = Boolean(
      detail &&
        summaryThreadKey(selectedMessageId) &&
        detail.threadKey === summaryThreadKey(selectedMessageId),
    )
    if (sameThread) {
      setDetailSwitching(true)
    } else {
      setDetailLoading(true)
      setThreadMessages([])
    }
    setDetailError(null)
    api
      .message(selectedMessageId)
      .then((response) => {
        if (cancelled) {
          return
        }
        setDetail(response.message)
        // The row in the list already knows the conversation; fall back to it when
        // an older cached detail response does not carry the key yet.
        const threadKey = response.message.threadKey ?? summaryThreadKey(selectedMessageId)
        if (!threadKey) {
          setThreadMessages([])
          return
        }
        if (sameThread) {
          // Already showing the conversation: leave the stack alone.
          return
        }
        api
          .threadMessages(response.message.accountId, threadKey)
          .then((thread) => {
            if (!cancelled) {
              setThreadMessages(thread.messages)
            }
          })
          .catch(() => {
            if (!cancelled) {
              setThreadMessages([])
            }
          })
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
          setDetailSwitching(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedMessageId, auth])

  useEffect(() => {
    const needle = query.trim()
    if (auth !== 'ok' || !needle) {
      setSearchResults(null)
      setSearchContacts([])
      setSearchLoading(false)
      setSearchError(null)
      setSearchCursor(null)
      return
    }
    let cancelled = false
    setSearchLoading(true)
    const timer = window.setTimeout(() => {
      api
        .search({
          query: needle,
          accountId: selectedAccountId,
          folder: searchScope,
        })
        .then((response) => {
          if (cancelled) {
            return
          }
          setSearchResults(response.messages)
          setSearchContacts(response.contacts)
          setSearchCursor(response.nextCursor ?? null)
          setSearchError(null)
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return
          }
          if (error instanceof ApiError && error.isUnauthorized) {
            setAuth('needed')
            return
          }
          setSearchResults([])
          setSearchContacts([])
          setSearchError(errorText(error, tRef.current))
        })
        .finally(() => {
          if (!cancelled) {
            setSearchLoading(false)
          }
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, selectedAccountId, searchScope, auth, refreshKey])

  const visibleMessages = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const searching = needle.length > 0
    let result: MessageSummary[]
    if (searching && searchResults) {
      result = searchResults
    } else {
      result = messages
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
    }
    if (hiddenIds.length > 0) {
      result = result.filter((message) => !hiddenIds.includes(message.id))
    }
    if (!searching && selectedLabelId) {
      result = result.filter((message) => message.labelIds.includes(selectedLabelId))
    }
    return result
  }, [messages, query, searchResults, selectedLabelId, hiddenIds])

  const listHasMore = query.trim() ? Boolean(searchCursor) : Boolean(nextCursor)

  async function loadMore() {
    const needle = query.trim()
    const cursor = needle ? searchCursor : nextCursor
    if (!cursor || loadingMore) {
      return
    }
    setLoadingMore(true)
    try {
      if (needle) {
        const response = await api.search({
          query: needle,
          accountId: selectedAccountId,
          folder: searchScope,
          before: cursor,
        })
        setSearchResults((current) => mergePage(current ?? [], response.messages))
        setSearchCursor(response.nextCursor ?? null)
      } else {
        const response = await api.threads({
          accountId: selectedAccountId,
          folder,
          labelId: selectedLabelId,
          before: cursor,
        })
        setMessages((current) => mergePage(current, response.threads.map(threadSummary)))
        setNextCursor(response.nextCursor ?? null)
      }
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        setAuth('needed')
        return
      }
      setSettingsError(errorText(error, tRef.current))
    } finally {
      setLoadingMore(false)
    }
  }

  /** Conversation key of a message already listed, if any. */
  function summaryThreadKey(id: string | null): string | null {
    if (!id) {
      return null
    }
    const found =
      messages.find((item) => item.id === id) ?? searchResults?.find((item) => item.id === id)
    return found?.threadKey ?? null
  }

  /** A conversation row is rendered with the newest message plus its counters. */
  function threadSummary(thread: MailThread): MessageSummary {
    return {
      ...thread.latest,
      threadKey: thread.threadKey,
      threadCount: thread.total,
      threadUnread: thread.unread,
      threadParticipants: thread.participants,
    }
  }

  function openCompose(draft: DraftPayload | null, seed: ComposeSeed | null = null) {
    setComposeDraft(draft)
    setComposeSeed(seed)
    setComposeKey((key) => key + 1)
    setComposeOpen(true)
    if (!composeHistoryRef.current) {
      composeHistoryRef.current = true
      try {
        window.history.pushState(
          { ...(window.history.state ?? {}), __whelkmailCompose: true },
          '',
        )
      } catch {
        composeHistoryRef.current = false
      }
    }
  }

  function dismissCompose() {
    setComposeOpen(false)
    if (composeHistoryRef.current) {
      composeHistoryRef.current = false
      try {
        window.history.back()
      } catch {
        // ignore
      }
    }
  }

  useEffect(() => {
    function onPopState() {
      if (!composeHistoryRef.current) {
        return
      }
      composeHistoryRef.current = false
      setComposeOpen(false)
      setComposeDraft(null)
      setComposeSeed(null)
      setRefreshKey((key) => key + 1)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  /**
   * Account whose address received the message, when the mailbox that stores it
   * is just a forwarding destination (EMAIL@DOMAIN.IT → EMAIL@PROVIDER.IT).
   * Only accounts that can send are considered.
   */
  function aliasAccountFor(message: MessageDetail): string | null {
    const addresses = new Set(
      [
        ...(message.aliasAddresses ?? []),
        ...message.to.map((item) => item.email),
        ...message.cc.map((item) => item.email),
      ]
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    )
    const match = accounts.find(
      (item) =>
        item.id !== message.accountId &&
        (item.kind === 'relay' ? item.relayConfigured : item.connected) &&
        addresses.has(item.email.toLowerCase()),
    )
    return match?.id ?? null
  }

  function replyTo(message: MessageDetail, all: boolean) {
    const receivingAccount = accounts.find((item) => item.id === message.accountId)
    const sendingAccountId = pickReplySender({
      messageAccountId: message.accountId,
      replyAccountId: receivingAccount?.replyAccountId ?? null,
      aliasAccountId: aliasAccountFor(message),
      defaultSender: defaultSenderReply,
      accountIds: accounts.map((item) => item.id),
    })
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
      inReplyTo: message.messageId,
      references: message.references,
      to,
      cc,
      bcc: [],
      subject,
      text,
    })
  }

  async function selectMessage(id: string) {
    const summary =
      messages.find((item) => item.id === id) ??
      searchResults?.find((item) => item.id === id)
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
      try {
        await api.deleteAccount(id)
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== 'account_used_as_copy_target') {
          throw error
        }
        // Sent copies of these accounts live in this mailbox: deleting it makes
        // their attachments and .eml unreachable.
        if (!window.confirm(t('settings.deleteCopiesTarget', { accounts: error.detail ?? '' }))) {
          setSettingsBusyId(null)
          return
        }
        await api.deleteAccount(id, true)
      }
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

  async function updateLabel(id: string, input: LabelInput): Promise<Label | null> {
    try {
      const response = await api.updateLabel(id, input)
      setLabels((current) => current.map((item) => (item.id === id ? response.label : item)))
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
    setListLoaded(false)
    setMessages([])
    setFolder(next)
    setRefreshKey((key) => key + 1)
    setSelectedLabelId(null)
    setView('mail')
    setSelectedMessageId(null)
    setDetail(null)
    setSelectedIds([])
    setHiddenIds([])
    setQuery('')
  }

  function selectLabel(id: string | null) {
    setListLoaded(false)
    setMessages([])
    setSelectedLabelId(id)
    setRefreshKey((key) => key + 1)
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

  async function changeAllowRemoteImages(value: boolean) {
    setAllowRemoteImages(value)
    try {
      await api.updateSettings({ allowRemoteImages: value })
    } catch (error) {
      setSettingsError(errorText(error, tRef.current))
    }
  }

  async function changeMetadataRetention(value: number) {
    const previous = metadataRetentionDays
    if (
      value > 0 &&
      (previous === 0 || value < previous) &&
      !window.confirm(t('settings.retentionConfirm'))
    ) {
      return
    }
    setMetadataRetentionDays(value)
    try {
      await api.updateSettings({ metadataRetentionDays: value })
    } catch (error) {
      setMetadataRetentionDays(previous)
      setSettingsError(errorText(error, tRef.current))
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
        accounts={accounts}
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
        onUpdateLabel={updateLabel}
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
          scope={searchScope}
          searching={searchLoading}
          onScopeChange={setSearchScope}
          onSelectAccount={(id) => {
            setListLoaded(false)
            setMessages([])
            setSelectedAccountId(id)
            setRefreshKey((key) => key + 1)
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
            <button
              type="button"
              onClick={() => {
                setListErrors([])
                setListLoaded(false)
                setRefreshKey((key) => key + 1)
              }}
              className="mt-1.5 rounded-lg border border-amber-300 bg-white px-2 py-1 font-medium text-amber-900 hover:bg-amber-100"
            >
              {t('common.retry')}
            </button>
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
            allowRemoteImages={allowRemoteImages}
            onAllowRemoteImagesChange={(value) => void changeAllowRemoteImages(value)}
            metadataRetentionDays={metadataRetentionDays}
            onMetadataRetentionChange={(value) => void changeMetadataRetention(value)}
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
          <>
            {query.trim() && searchError ? (
              <div className="mx-4 mb-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-brand-strong">
                {searchError}
              </div>
            ) : null}
            {query.trim() && searchContacts.length > 0 ? (
              <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs">
                <span className="font-medium text-slate-700">{t('search.contacts')}</span>
                {searchContacts.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() =>
                      openCompose(null, {
                        accountId: composeAccountId ?? accounts[0]?.id ?? '',
                        to: [contact.email],
                        cc: [],
                        bcc: [],
                        subject: '',
                        text: '',
                      })
                    }
                    title={contact.email}
                    className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 hover:bg-slate-200"
                  >
                    <span className="font-medium">{contact.name || contact.email}</span>
                    {contact.name ? (
                      <span className="text-[10px] text-muted">{contact.email}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 overflow-hidden px-0 pb-0 sm:px-4 sm:pb-2 lg:px-6 lg:pb-3">
            {readingPane ? (
              <>
                <MailList
                  messages={visibleMessages}
                  labels={labels}
                  selectedId={selectedMessageId}
                  loading={!listLoaded}
                  syncing={syncingMessages}
                  folder={folder}
                  labelName={selectedLabel?.name ?? null}
                  titleOverride={query.trim() ? t('search.resultsTitle', { query: query.trim() }) : null}
                  showFolder={Boolean(query.trim())}
                  className={selectedMessageId ? 'hidden md:flex' : ''}
                  selectedIds={selectedIds}
                  actionBusy={actionBusy}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={toggleSelectAll}
                  onAction={(action, target) =>
                    void runMessageAction(selectedIds, action, target)
                  }
                  onMessageAction={(id, action, target) =>
                    void runMessageAction([id], action, target)
                  }
                  onSelect={(id) => void selectMessage(id)}
                  hasMore={listHasMore}
                  loadingMore={loadingMore}
                  onLoadMore={() => void loadMore()}
                />
                <ReadingPane
                  message={detail}
                  thread={threadMessages}
                  onSelectMessage={(id) => void selectMessage(id)}
                  labels={labels}
                  loading={detailLoading}
                  switching={detailSwitching}
                  error={detailError}
                  allowRemoteImages={allowRemoteImages}
                  onAlwaysShowImages={() => void changeAllowRemoteImages(true)}
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
                thread={threadMessages}
                onSelectMessage={(id) => void selectMessage(id)}
                labels={labels}
                loading={detailLoading}
                switching={detailSwitching}
                error={detailError}
                allowRemoteImages={allowRemoteImages}
                onAlwaysShowImages={() => void changeAllowRemoteImages(true)}
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
                loading={!listLoaded}
                syncing={syncingMessages}
                folder={folder}
                labelName={selectedLabel?.name ?? null}
                titleOverride={query.trim() ? t('search.resultsTitle', { query: query.trim() }) : null}
                showFolder={Boolean(query.trim())}
                fullWidth
                selectedIds={selectedIds}
                actionBusy={actionBusy}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onAction={(action, target) =>
                  void runMessageAction(selectedIds, action, target)
                }
                onMessageAction={(id, action, target) =>
                  void runMessageAction([id], action, target)
                }
                onSelect={(id) => void selectMessage(id)}
                hasMore={listHasMore}
                loadingMore={loadingMore}
                onLoadMore={() => void loadMore()}
              />
            )}
          </div>
          </>
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
            dismissCompose()
            setComposeDraft(null)
            setComposeSeed(null)
            setRefreshKey((key) => key + 1)
          }}
          onSent={(warning, sentFolder) => {
            dismissCompose()
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
            dismissCompose()
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
            dismissCompose()
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
