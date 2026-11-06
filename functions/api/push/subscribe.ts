import { pushSubscribeSchema, pushUnsubscribeSchema } from '../../../shared/schemas'
import type { Env } from '../../_lib/env'
import { fail, json, readJson } from '../../_lib/http'
import { isSchemaError, schemaOutdated } from '../../_lib/schema'

export const onRequestPost: PagesFunction<Env> = async (context) => {
  try {
    const parsed = pushSubscribeSchema.safeParse(await readJson<unknown>(context.request))
    if (!parsed.success) {
      return fail(
        'Invalid subscription',
        400,
        parsed.error.issues.map((issue) => issue.message).join('; '),
        'push_subscription_invalid',
      )
    }
    const input = parsed.data
    const now = new Date().toISOString()
    await context.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, updated_at = excluded.updated_at`,
    )
      .bind(
        crypto.randomUUID(),
        input.endpoint,
        input.keys.p256dh,
        input.keys.auth,
        input.userAgent ?? null,
        now,
        now,
      )
      .run()
    return json({ ok: true })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  try {
    const parsed = pushUnsubscribeSchema.safeParse(await readJson<unknown>(context.request))
    if (!parsed.success) {
      return fail('Invalid subscription', 400, undefined, 'push_subscription_invalid')
    }
    await context.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
      .bind(parsed.data.endpoint)
      .run()
    return json({ ok: true })
  } catch (error) {
    if (isSchemaError(error)) {
      return schemaOutdated(error)
    }
    throw error
  }
}
