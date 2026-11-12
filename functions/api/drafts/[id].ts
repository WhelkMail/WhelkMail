import type { Env } from '../../_lib/env'
import { fail, json } from '../../_lib/http'
import { deleteDraftById } from '../../_lib/mail/drafts'

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string
  try {
    await deleteDraftById(context.env, id, (promise) => context.waitUntil(promise))
  } catch (error) {
    return fail(
      'Deleting the draft failed',
      500,
      error instanceof Error ? error.message : 'error',
      'draft_delete_failed',
    )
  }
  return json({ ok: true })
}
