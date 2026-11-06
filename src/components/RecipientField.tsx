import { useState } from 'react'
import type { Contact } from '../../shared/types'
import { displayAddress } from '../lib/utils'

interface RecipientFieldProps {
  value: string
  contacts: Contact[]
  onChange: (value: string) => void
  placeholder?: string
  inputClassName?: string
}

export function RecipientField({
  value,
  contacts,
  onChange,
  placeholder,
  inputClassName,
}: RecipientFieldProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const lastComma = value.lastIndexOf(',')
  const prefix = lastComma >= 0 ? value.slice(0, lastComma + 1) : ''
  const token = (lastComma >= 0 ? value.slice(lastComma + 1) : value).trim()
  const usedEmails = new Set(
    value
      .toLowerCase()
      .match(/[^\s,<>]+@[^\s,<>]+/g)
      ?.map((email) => email.replace(/[>,;]+$/, '')) ?? [],
  )
  const needle = token.toLowerCase()
  const suggestions = contacts
    .filter((contact) => {
      if (usedEmails.has(contact.email.toLowerCase())) {
        return false
      }
      return (
        needle.length === 0 || `${contact.name} ${contact.email}`.toLowerCase().includes(needle)
      )
    })
    .slice(0, 8)

  function choose(contact: Contact) {
    const separator = prefix ? `${prefix.trimEnd()} ` : ''
    onChange(`${separator}${displayAddress(contact)}, `)
    setOpen(false)
    setActive(0)
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) {
            return
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive((current) => (current + 1) % suggestions.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((current) => (current - 1 + suggestions.length) % suggestions.length)
          } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            choose(suggestions[active] ?? suggestions[0])
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
        placeholder={placeholder}
        className={inputClassName}
        autoComplete="off"
      />
      {open && suggestions.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-lg">
          {suggestions.map((contact, index) => (
            <button
              key={contact.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(contact)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                index === active ? 'bg-slate-100' : 'hover:bg-slate-50'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-800">{contact.name}</span>
                <span className="block truncate text-muted">{contact.email}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
