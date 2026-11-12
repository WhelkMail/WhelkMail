import type {
  Account,
  AccountCreateInput,
  AccountPatch,
  AppSettings,
  Contact,
  ContactInput,
  DeletionLog,
  DraftPayload,
  DraftSavePayload,
  FilterInput,
  Folder,
  HealthStatus,
  Label,
  LabelInput,
  LoginResult,
  MailboxSyncState,
  MailFilter,
  MessageDetail,
  MessageListResult,
  MessageSearchResult,
  PushPrefs,
  PushSubscriptionInput,
  RetentionSummary,
  SearchScope,
  SendPayload,
  StorageOptions,
  SyncOverview,
  TotpEnableResult,
  TotpSetup,
  TwoFactorStatus,
} from '../../shared/types'

export class ApiError extends Error {
  status: number
  detail?: string
  code?: string

  constructor(status: number, message: string, detail?: string, code?: string) {
    super(message)
    this.status = status
    this.detail = detail
    this.code = code
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const contentType = response.headers.get('Content-Type') ?? ''
  const data = contentType.includes('application/json') ? await response.json() : null
  if (!response.ok) {
    const message = (data as { error?: string } | null)?.error ?? `HTTP ${response.status}`
    const detail = (data as { detail?: string } | null)?.detail
    const code = (data as { code?: string } | null)?.code
    throw new ApiError(response.status, message, detail, code)
  }
  return data as T
}

export interface AccountError {
  accountId: string
  email: string
  message: string
}

export const api = {
  login(password: string): Promise<LoginResult> {
    return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
  },
  loginTwoFactor(challenge: string, code: string): Promise<{ ok: boolean }> {
    return request('/api/auth/2fa', {
      method: 'POST',
      body: JSON.stringify({ challenge, code }),
    })
  },
  totpStatus(): Promise<TwoFactorStatus> {
    return request('/api/auth/totp')
  },
  totpSetup(): Promise<TotpSetup> {
    return request('/api/auth/totp', { method: 'POST', body: JSON.stringify({ action: 'setup' }) })
  },
  totpEnable(code: string): Promise<TotpEnableResult> {
    return request('/api/auth/totp', {
      method: 'POST',
      body: JSON.stringify({ action: 'enable', code }),
    })
  },
  totpDisable(password: string, code: string): Promise<{ ok: boolean }> {
    return request('/api/auth/totp', {
      method: 'POST',
      body: JSON.stringify({ action: 'disable', password, code }),
    })
  },
  logout(): Promise<{ ok: boolean }> {
    return request('/api/auth/logout', { method: 'POST' })
  },
  health(): Promise<HealthStatus> {
    return request('/api/health')
  },
  storageOptions(): Promise<StorageOptions> {
    return request('/api/storage/options')
  },
  accounts(): Promise<{ accounts: Account[] }> {
    return request('/api/accounts')
  },
  createAccount(input: AccountCreateInput): Promise<{ account: Account }> {
    return request('/api/accounts', { method: 'POST', body: JSON.stringify(input) })
  },
  updateAccount(id: string, patch: AccountPatch): Promise<{ account: Account }> {
    return request(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
  },
  deleteAccount(id: string): Promise<{ ok: boolean }> {
    return request(`/api/accounts/${id}`, { method: 'DELETE' })
  },
  syncStatus(
    id: string,
  ): Promise<{ folders: MailboxSyncState[]; hasMore: boolean }> {
    return request(`/api/accounts/${id}/sync`)
  },
  syncOverview(): Promise<SyncOverview> {
    return request('/api/sync')
  },
  runSync(
    id: string,
    folder: string,
  ): Promise<{ folders: MailboxSyncState[]; hasMore: boolean; error?: string }> {
    return request(`/api/accounts/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify({ folder }),
    })
  },
  contacts(query?: string): Promise<{ contacts: Contact[] }> {
    const search = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
    return request(`/api/contacts${search}`)
  },
  createContact(input: ContactInput): Promise<{ contact: Contact }> {
    return request('/api/contacts', { method: 'POST', body: JSON.stringify(input) })
  },
  updateContact(id: string, input: ContactInput): Promise<{ contact: Contact }> {
    return request(`/api/contacts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  deleteContact(id: string): Promise<{ ok: boolean }> {
    return request(`/api/contacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  labels(): Promise<{ labels: Label[] }> {
    return request('/api/labels')
  },
  createLabel(input: LabelInput): Promise<{ label: Label }> {
    return request('/api/labels', { method: 'POST', body: JSON.stringify(input) })
  },
  updateLabel(id: string, input: LabelInput): Promise<{ label: Label }> {
    return request(`/api/labels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  deleteLabel(id: string): Promise<{ ok: boolean }> {
    return request(`/api/labels/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  setMessageLabels(id: string, labelIds: string[]): Promise<{ ok: boolean; labelIds: string[] }> {
    return request(`/api/messages/${encodeURIComponent(id)}/labels`, {
      method: 'PUT',
      body: JSON.stringify({ labelIds }),
    })
  },
  settings(): Promise<AppSettings> {
    return request('/api/settings')
  },
  updateSettings(input: Partial<AppSettings>): Promise<AppSettings> {
    return request('/api/settings', { method: 'PATCH', body: JSON.stringify(input) })
  },
  retention(): Promise<{ retention: RetentionSummary }> {
    return request('/api/retention')
  },
  resetRetentionMirror(
    accountId?: string,
  ): Promise<{ ok: boolean; accounts: number; folders: number; retention: RetentionSummary }> {
    return request('/api/retention', {
      method: 'POST',
      body: JSON.stringify(accountId ? { accountId } : {}),
    })
  },
  pushKey(): Promise<{ publicKey: string | null }> {
    return request('/api/push/key')
  },
  subscribePush(input: PushSubscriptionInput): Promise<{ ok: boolean }> {
    return request('/api/push/subscribe', { method: 'POST', body: JSON.stringify(input) })
  },
  unsubscribePush(endpoint: string): Promise<{ ok: boolean }> {
    return request('/api/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    })
  },
  pushPrefs(): Promise<{ prefs: PushPrefs[] }> {
    return request('/api/push/prefs')
  },
  updatePushPrefs(input: {
    accountId: string
    enabled?: boolean
    folders?: string[]
  }): Promise<{ ok: boolean; prefs: PushPrefs[] }> {
    return request('/api/push/prefs', { method: 'PATCH', body: JSON.stringify(input) })
  },
  deletionLogs(accountId: string): Promise<{ logs: DeletionLog[] }> {
    return request(`/api/accounts/${encodeURIComponent(accountId)}/deletions`)
  },
  filters(): Promise<{ filters: MailFilter[] }> {
    return request('/api/filters')
  },
  createFilter(input: FilterInput): Promise<{ filter: MailFilter }> {
    return request('/api/filters', { method: 'POST', body: JSON.stringify(input) })
  },
  updateFilter(id: string, input: FilterInput): Promise<{ filter: MailFilter }> {
    return request(`/api/filters/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  deleteFilter(id: string): Promise<{ ok: boolean }> {
    return request(`/api/filters/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  testAccount(id: string): Promise<{ ok: boolean; checks?: Record<string, string> }> {
    return request(`/api/accounts/${id}/test`, { method: 'POST' })
  },
  messages(
    accountId: string,
    folder: Folder,
    labelId?: string | null,
    before?: string | null,
  ): Promise<MessageListResult> {
    const search = new URLSearchParams({ accountId, folder })
    if (labelId) {
      search.set('labelId', labelId)
    }
    if (before) {
      search.set('before', before)
    }
    return request(`/api/messages?${search.toString()}`)
  },
  message(id: string): Promise<{ message: MessageDetail }> {
    return request(`/api/messages/${encodeURIComponent(id)}`)
  },
  search(options: {
    query: string
    accountId: string
    folder?: SearchScope
    contacts?: boolean
    before?: string | null
  }): Promise<MessageSearchResult> {
    const params = new URLSearchParams({ q: options.query, accountId: options.accountId })
    if (options.folder && options.folder !== 'all') {
      params.set('folder', options.folder)
    }
    if (options.contacts === false) {
      params.set('contacts', '0')
    }
    if (options.before) {
      params.set('before', options.before)
    }
    return request(`/api/messages/search?${params.toString()}`)
  },
  messageAction(
    ids: string[],
    action: 'delete' | 'spam' | 'move',
    target?: 'inbox' | 'spam' | 'trash',
  ): Promise<{
    ok: boolean
    moved: number
    skipped: string[]
    errors: { ids: string[]; message: string }[]
  }> {
    return request('/api/messages/actions', {
      method: 'POST',
      body: JSON.stringify({ ids, action, target }),
    })
  },
  send(payload: SendPayload): Promise<{ ok: boolean; warning?: string; sentFolder?: string }> {
    return request('/api/messages/send', { method: 'POST', body: JSON.stringify(payload) })
  },
  draft(id: string): Promise<{ draft: DraftPayload }> {
    return request(`/api/messages/${encodeURIComponent(id)}/draft`)
  },
  saveDraft(payload: DraftSavePayload): Promise<{ ok: boolean; draftId?: string }> {
    return request('/api/drafts', { method: 'POST', body: JSON.stringify(payload) })
  },
  deleteDraft(id: string): Promise<{ ok: boolean }> {
    return request(`/api/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },
  rawUrl(id: string): string {
    return `/api/messages/${encodeURIComponent(id)}/raw`
  },
  attachmentUrl(id: string, index: number): string {
    return `/api/messages/${encodeURIComponent(id)}/attachments/${index}`
  },
  driveConnectUrl(accountId: string): string {
    return `/api/drive/oauth/start?accountId=${encodeURIComponent(accountId)}`
  },
  microsoftConnectUrl(accountId: string): string {
    return `/api/microsoft/oauth/start?accountId=${encodeURIComponent(accountId)}`
  },
  googleConnectUrl(accountId: string): string {
    return `/api/google/oauth/start?accountId=${encodeURIComponent(accountId)}`
  },
}
