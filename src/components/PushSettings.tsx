import { useEffect, useState } from 'react'
import { Bell, BellOff, CheckCircle2 } from 'lucide-react'
import type { Folder, PushPrefs } from '../../shared/types'
import { useI18n } from '../i18n'
import { api } from '../lib/api'
import { errorText } from '../lib/errors'
import { cn } from '../lib/utils'

const FOLDERS: Folder[] = ['inbox', 'sent', 'draft']

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function folderLabel(folder: Folder, t: (key: string) => string): string {
  return folder === 'inbox' ? t('list.inbox') : folder === 'sent' ? t('list.sent') : t('list.drafts')
}

export function PushSettings() {
  const { t } = useI18n()
  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<PushPrefs[]>([])
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : 'denied',
  )
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [keyResponse, prefsResponse] = await Promise.all([api.pushKey(), api.pushPrefs()])
        if (cancelled) {
          return
        }
        setPublicKey(keyResponse.publicKey)
        setPrefs(prefsResponse.prefs)
        if (supported) {
          const registration = await navigator.serviceWorker.getRegistration()
          const subscription = await registration?.pushManager.getSubscription()
          if (subscription) {
            setEndpoint(subscription.endpoint)
            if (keyResponse.publicKey) {
              const json = subscription.toJSON()
              if (json.endpoint && json.keys?.p256dh && json.keys.auth) {
                await api
                  .subscribePush({
                    endpoint: json.endpoint,
                    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
                  })
                  .catch(() => undefined)
              }
            }
          }
          setPermission(Notification.permission)
        }
      } catch (reason) {
        if (!cancelled) {
          setError(errorText(reason, t))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [supported, t])

  async function enable() {
    if (!publicKey) {
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') {
        setError(t('push.denied'))
        return
      }
      let registration = await navigator.serviceWorker.getRegistration()
      if (!registration) {
        registration = await navigator.serviceWorker.register('/sw.js')
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey),
      })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error(t('push.subscribeError'))
      }
      await api.subscribePush({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      })
      setEndpoint(json.endpoint)
      setMessage(t('push.enabled'))
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await subscription.unsubscribe()
      }
      if (endpoint) {
        await api.unsubscribePush(endpoint)
      }
      setEndpoint(null)
      setMessage(t('push.disabled'))
    } catch (reason) {
      setError(errorText(reason, t))
    } finally {
      setBusy(false)
    }
  }

  async function savePref(accountId: string, patch: { enabled?: boolean; folders?: Folder[] }) {
    setError(null)
    try {
      const response = await api.updatePushPrefs({ accountId, ...patch })
      setPrefs(response.prefs)
      setMessage(t('push.saved'))
    } catch (reason) {
      setError(errorText(reason, t))
    }
  }

  if (loading) {
    return <p className="mt-4 text-xs text-muted">{t('common.loading')}</p>
  }

  return (
    <div className="mt-6 rounded-2xl border border-line bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-muted" />
          <p className="text-sm font-medium">{t('push.title')}</p>
        </div>
        {endpoint ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
            <CheckCircle2 size={12} /> {t('push.active')}
          </span>
        ) : null}
      </div>
      <p className="mb-4 text-[11px] text-muted">{t('push.hint')}</p>

      {!supported ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">{t('push.unsupported')}</p>
      ) : !publicKey ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
          {t('push.notConfigured')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {endpoint ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void disable()}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
              >
                <BellOff size={14} /> {t('push.disable')}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || permission === 'denied'}
                onClick={() => void enable()}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              >
                <Bell size={14} /> {t('push.enable')}
              </button>
            )}
            <span className="text-[11px] text-muted">
              {t('push.permission')}: {t(`push.permissionStatus.${permission}`)}
            </span>
          </div>

          {permission === 'denied' ? (
            <p className="mt-2 text-[11px] text-brand-strong">{t('push.denied')}</p>
          ) : null}

          {endpoint ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-700">{t('push.preferences')}</p>
              <div className="space-y-2">
                {prefs.map((pref) => (
                  <div key={pref.accountId} className="rounded-xl border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-slate-700">
                        {pref.email}
                      </span>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
                        <input
                          type="checkbox"
                          checked={pref.enabled}
                          onChange={(event) =>
                            void savePref(pref.accountId, { enabled: event.target.checked })
                          }
                          className="h-3.5 w-3.5"
                        />
                        {t('push.enabledForAccount')}
                      </label>
                    </div>
                    {pref.enabled ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {FOLDERS.map((folder) => {
                          const checked = pref.folders.includes(folder)
                          return (
                            <label
                              key={folder}
                              className={cn(
                                'flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]',
                                checked
                                  ? 'border-brand bg-brand-soft text-brand-strong'
                                  : 'border-line text-muted',
                              )}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  const folders = event.target.checked
                                    ? [...pref.folders, folder]
                                    : pref.folders.filter((item) => item !== folder)
                                  void savePref(pref.accountId, { folders })
                                }}
                                className="h-3 w-3"
                              />
                              {folderLabel(folder, t)}
                            </label>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      {error ? <p className="mt-2 text-[11px] text-brand-strong">{error}</p> : null}
      {message ? <p className="mt-2 text-[11px] text-emerald-700">{message}</p> : null}
    </div>
  )
}
