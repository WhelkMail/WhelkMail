import type { Env } from '../_lib/env'
import { googleMailConfigured } from '../_lib/google/oauth'
import { json } from '../_lib/http'
import { microsoftConfigured } from '../_lib/microsoft/oauth'
import { relayInfo } from '../_lib/relay'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const relay = relayInfo(context.env)
  return json({
    ok: true,
    driveConfigured: Boolean(context.env.GOOGLE_CLIENT_ID && context.env.GOOGLE_CLIENT_SECRET),
    r2Configured: Boolean(context.env.BUCKET),
    relayConfigured: relay.configured,
    relayProvider: relay.provider,
    relayLabel: relay.label,
    maxAttachmentBytes: relay.maxAttachmentBytes,
    microsoftConfigured: microsoftConfigured(context.env),
    googleMailConfigured: googleMailConfigured(context.env),
    pushConfigured: Boolean(context.env.VAPID_PUBLIC_KEY && context.env.VAPID_PRIVATE_KEY),
    cronConfigured: Boolean(context.env.CRON_SECRET),
  })
}
