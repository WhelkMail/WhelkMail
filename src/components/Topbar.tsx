import { useEffect, useRef, useState } from 'react'
import { Check, LogOut, Menu, Search, Settings, UserRound } from 'lucide-react'
import type { Account } from '../../shared/types'
import { useI18n } from '../i18n'
import { cn } from '../lib/utils'

interface TopbarProps {
  accounts: Account[]
  selectedAccountId: string
  query: string
  onSelectAccount: (id: string) => void
  onQuery: (value: string) => void
  onOpenSettings: () => void
  onLogout: () => void
  onMenu: () => void
}

export function Topbar({
  accounts,
  selectedAccountId,
  query,
  onSelectAccount,
  onQuery,
  onOpenSettings,
  onLogout,
  onMenu,
}: TopbarProps) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) {
      return
    }
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  function selectAccount(id: string) {
    onSelectAccount(id)
    setMenuOpen(false)
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-2 sm:gap-3 sm:px-4">
      <button
        type="button"
        onClick={onMenu}
        title={t('topbar.menu')}
        aria-label={t('topbar.menu')}
        className="rounded-full p-2 text-muted hover:bg-slate-200/60 md:hidden"
      >
        <Menu size={20} />
      </button>
      <div className="flex h-11 max-w-2xl flex-1 items-center gap-3 rounded-full bg-[#eaf1fb] px-4 focus-within:bg-white focus-within:shadow-md">
        <Search size={18} className="text-muted" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t('topbar.searchPlaceholder')}
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted"
        />
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          title={t('topbar.settings')}
          aria-label={t('topbar.settings')}
          className="rounded-full p-2 text-muted hover:bg-slate-200/60"
        >
          <Settings size={20} />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            title={t('topbar.accountMenu')}
            aria-label={t('topbar.accountMenu')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white hover:bg-brand-strong"
          >
            <UserRound size={18} />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg"
            >
              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {t('topbar.accounts')}
              </p>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selectedAccountId === 'all'}
                onClick={() => selectAccount('all')}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50',
                  selectedAccountId === 'all' ? 'text-brand-strong' : 'text-slate-700',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{t('topbar.allAccounts')}</span>
                {selectedAccountId === 'all' ? <Check size={14} className="shrink-0" /> : null}
              </button>
              {accounts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedAccountId === item.id}
                  onClick={() => selectAccount(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50',
                    selectedAccountId === item.id ? 'text-brand-strong' : 'text-slate-700',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.email}</span>
                  {selectedAccountId === item.id ? <Check size={14} className="shrink-0" /> : null}
                </button>
              ))}

              <div className="my-1 border-t border-line" />

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onLogout()
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted hover:bg-slate-50 hover:text-slate-800"
              >
                <LogOut size={15} /> {t('topbar.logout')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
