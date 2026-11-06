interface Env {
  APP_URL: string
  CRON_SECRET: string
}

export default {
  async scheduled(
    _controller: unknown,
    env: Env,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ): Promise<void> {
    const base = env.APP_URL.replace(/\/$/, '')
    ctx.waitUntil(
      fetch(`${base}/api/cron/notifications`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
      }).then(() => undefined),
    )
  },
  async fetch(): Promise<Response> {
    return new Response('WhelkMail notification cron worker')
  },
}
