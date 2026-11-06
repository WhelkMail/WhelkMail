import { ApiError } from './api'

type Translate = (key: string, vars?: Record<string, string | number>) => string

export function errorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.code) {
      const key = `errors.${error.code}`
      const translated = t(key)
      if (translated !== key) {
        return error.detail ? `${translated}: ${error.detail}` : translated
      }
    }
    return error.detail ? `${error.message}: ${error.detail}` : error.message
  }
  return error instanceof Error ? error.message : t('errors.internal')
}
