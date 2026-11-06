import type { Env } from './env'

const WINDOW_SECONDS = 15 * 60
const MAX_ATTEMPTS = 10
const BLOCK_SECONDS = 15 * 60

interface AttemptRow {
  count: number
  window_start: number
  blocked_until: number | null
}

export function clientIp(request: Request): string {
  const direct = request.headers.get('CF-Connecting-IP')
  if (direct) {
    return direct.slice(0, 64)
  }
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
  return forwarded ? forwarded.slice(0, 64) : 'unknown'
}

export async function checkLoginRate(
  env: Env,
  ip: string,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Math.floor(Date.now() / 1000)
  const row = await env.DB.prepare(
    'SELECT count, window_start, blocked_until FROM login_attempts WHERE ip = ?',
  )
    .bind(ip)
    .first<AttemptRow>()
  if (!row) {
    return { allowed: true, retryAfter: 0 }
  }
  if (row.blocked_until && row.blocked_until > now) {
    return { allowed: false, retryAfter: row.blocked_until - now }
  }
  if (row.window_start + WINDOW_SECONDS <= now) {
    return { allowed: true, retryAfter: 0 }
  }
  return { allowed: true, retryAfter: 0 }
}

export async function recordLoginFailure(env: Env, ip: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const row = await env.DB.prepare(
    'SELECT count, window_start, blocked_until FROM login_attempts WHERE ip = ?',
  )
    .bind(ip)
    .first<AttemptRow>()
  if (!row || row.window_start + WINDOW_SECONDS <= now) {
    await env.DB.prepare(
      'INSERT INTO login_attempts (ip, count, window_start, blocked_until) VALUES (?, 1, ?, NULL) ON CONFLICT(ip) DO UPDATE SET count = 1, window_start = excluded.window_start, blocked_until = NULL',
    )
      .bind(ip, now)
      .run()
    return
  }
  const count = row.count + 1
  const blockedUntil = count >= MAX_ATTEMPTS ? now + BLOCK_SECONDS : null
  await env.DB.prepare(
    'UPDATE login_attempts SET count = ?, blocked_until = ? WHERE ip = ?',
  )
    .bind(count, blockedUntil, ip)
    .run()
}

export async function clearLoginFailures(env: Env, ip: string): Promise<void> {
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run()
}
