import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { LabelColor } from '../../shared/types'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatDate(value: string, locale: string = 'en'): string {
  const date = new Date(value)
  const now = new Date()
  const intl = locale === 'it' ? 'it-IT' : 'en-US'
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    return new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  if (date.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short' }).format(date)
  }
  return new Intl.DateTimeFormat(intl, { day: '2-digit', month: '2-digit', year: '2-digit' }).format(date)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function initials(value: string): string {
  const cleaned = value.trim()
  if (!cleaned) {
    return '?'
  }
  const parts = cleaned.split(/\s+/)
  if (parts.length > 1) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return cleaned.slice(0, 2).toUpperCase()
}

export function parseAddresses(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function displayAddress(address: { name: string | null; email: string }): string {
  return address.name ? `${address.name} <${address.email}>` : address.email
}

export const LABEL_COLORS: { id: LabelColor; className: string; dot: string }[] = [
  { id: 'blue', className: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  { id: 'emerald', className: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  { id: 'amber', className: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  { id: 'violet', className: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
  { id: 'rose', className: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
  { id: 'cyan', className: 'bg-cyan-50 text-cyan-700', dot: 'bg-cyan-500' },
  { id: 'lime', className: 'bg-lime-50 text-lime-700', dot: 'bg-lime-500' },
]

export function labelStyle(color: LabelColor): string {
  return LABEL_COLORS.find((item) => item.id === color)?.className ?? LABEL_COLORS[0].className
}

export function labelDot(color: LabelColor): string {
  return LABEL_COLORS.find((item) => item.id === color)?.dot ?? LABEL_COLORS[0].dot
}

