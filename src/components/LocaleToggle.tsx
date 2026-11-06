import { LOCALES, useI18n } from '../i18n'
import { cn } from '../lib/utils'

export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useI18n()
  return (
    <div className={cn('flex items-center gap-1 rounded-lg border border-line bg-white p-0.5', className)}>
      {LOCALES.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setLocale(item.id)}
          className={cn(
            'rounded-md px-2 py-1 text-[11px]',
            locale === item.id ? 'bg-slate-900 text-white' : 'text-muted hover:bg-slate-100',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
