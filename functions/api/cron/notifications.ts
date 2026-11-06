import type { Folder } from '../../../shared/types'
import { listAccountRows } from '../../_lib/db'
import { deleteArchivedMessage } from '../../_lib/deletion'
import type { Env } from '../../_lib/env'
import { applyAccountLabel, applyFilters } from '../../_lib/filters'
import { forwardFilteredMessage } from '../../_lib/forward'
import { fail, json } from '../../_lib/http'
import { pushConfigured, sendWebPush, type PushSubscriptionRecord } from '../../_lib/push'
import {
  imapMessageSummary,
  markSyncError,
  runSyncChunk,
  type ImapMessageRow,
} from '../../_lib/sync'

interface PushPrefsRow {
  account_id: string
  enabled: number
  folders_json: string
}

function parseFolders(value: string): Folder[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return ['inbox']
    }
    return parsed.filter(
      (item): item is Folder => item === 'inbox' || item === 'sent' || item === 'draft',
    )
  } catch {
    return ['inbox']
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const secret = context.env.CRON_SECRET
  const authorization = context.request.headers.get('Authorization') ?? ''
  if (!secret || authorization !== `Bearer ${secret}`) {
    return fail('Unauthorized', 401, undefined, 'unauthorized')
  }

  const canNotify = pushConfigured(context.env)
  const subscriptions = canNotify
    ? await context.env.DB.prepare(
        'SELECT id, endpoint, p256dh, auth FROM push_subscriptions',
      ).all<PushSubscriptionRecord>()
    : { results: [] as PushSubscriptionRecord[] }
  const notify = canNotify && subscriptions.results.length > 0

  const prefRows = await context.env.DB.prepare('SELECT * FROM push_prefs').all<PushPrefsRow>()
  const prefs = new Map(prefRows.results.map((row) => [row.account_id, row]))
  const accounts = await listAccountRows(context.env)
  const forwardingFilters = await context.env.DB.prepare(
    "SELECT id FROM filters WHERE enabled = 1 AND forward_to_json <> '[]'",
  ).all<{ id: string }>()
  const hasForwarding = forwardingFilters.results.length > 0
  const gone = new Set<string>()
  let sent = 0
  let forwarded = 0
  let deleted = 0

  for (const account of accounts) {
    if (account.kind !== 'imap' || !account.secret_enc) {
      continue
    }
    const pref = prefs.get(account.id)
    const notifyEnabled = pref ? Boolean(pref.enabled) : true
    const pushFolders = new Set<Folder>(pref ? parseFolders(pref.folders_json) : ['inbox'])
    const folders = new Set<Folder>()
    if (notifyEnabled) {
      for (const folder of pushFolders) {
        folders.add(folder)
      }
    }
    if (hasForwarding || account.delete_after_archive) {
      folders.add('inbox')
    }
    if (account.auto_sync) {
      folders.add('inbox')
      folders.add('sent')
      folders.add('draft')
    }
    if (folders.size === 0) {
      continue
    }

    for (const folder of folders) {
      const previous = await context.env.DB.prepare(
        'SELECT max_uid FROM imap_sync WHERE account_id = ? AND folder = ?',
      )
        .bind(account.id, folder)
        .first<{ max_uid: number }>()
      const previousMax = previous?.max_uid ?? 0

      try {
        await runSyncChunk(context.env, account, folder)
      } catch (error) {
        await markSyncError(
          context.env,
          account.id,
          folder,
          error instanceof Error ? error.message : String(error),
        )
        continue
      }

      if (previousMax === 0) {
        continue
      }

      const fresh = await context.env.DB.prepare(
        'SELECT * FROM imap_messages WHERE account_id = ? AND folder = ? AND uid > ? ORDER BY uid ASC LIMIT 20',
      )
        .bind(account.id, folder, previousMax)
        .all<ImapMessageRow>()

      for (const row of fresh.results) {
        if (folder === 'inbox') {
          const summary = imapMessageSummary(row, account)
          const existingLabels = await context.env.DB.prepare(
            'SELECT label_id FROM message_labels WHERE message_id = ?',
          )
            .bind(row.id)
            .all<{ label_id: string }>()
          summary.labelIds = existingLabels.results.map((item) => item.label_id)
          const forwards = await applyFilters(context.env, account.id, [summary])
          await applyAccountLabel(
            context.env,
            account.id,
            account.incoming_label_id,
            [summary],
          )

          for (const match of forwards) {
            const result = await forwardFilteredMessage(
              context.env,
              account,
              match.filterId,
              match.forwardTo,
              row,
            )
            if (result === 'sent') {
              forwarded += 1
            }
          }

          if (account.delete_after_archive) {
            const result = await deleteArchivedMessage(context.env, account, row)
            if (result === 'done') {
              deleted += 1
            }
          }
        }

        if (notify && notifyEnabled && pushFolders.has(folder)) {
          const title = row.from_name || row.from_email || account.display_name
          const payload = {
            title,
            body: row.subject || '(nessun oggetto)',
            url: `/?message=${encodeURIComponent(row.id)}`,
            tag: row.id,
          }
          for (const subscription of subscriptions.results) {
            if (gone.has(subscription.endpoint)) {
              continue
            }
            try {
              const result = await sendWebPush(context.env, subscription, payload)
              if (result.ok) {
                sent += 1
              }
              if (result.gone) {
                gone.add(subscription.endpoint)
              }
            } catch {
              // Keep processing the remaining subscriptions.
            }
          }
        }
      }
    }

    if (account.delete_after_archive) {
      const pending = await context.env.DB.prepare(
        `SELECT m.* FROM imap_messages m
         LEFT JOIN deletion_log d ON d.message_id = m.id AND d.status = 'done'
         WHERE m.account_id = ? AND m.folder = 'inbox' AND m.archived = 1 AND m.archive_key IS NOT NULL AND d.id IS NULL
         ORDER BY m.uid ASC LIMIT 10`,
      )
        .bind(account.id)
        .all<ImapMessageRow>()
      for (const row of pending.results) {
        const result = await deleteArchivedMessage(context.env, account, row)
        if (result === 'done') {
          deleted += 1
        }
      }
    }
  }

  if (gone.size > 0) {
    await context.env.DB.batch(
      [...gone].map((endpoint) =>
        context.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint),
      ),
    )
  }

  return json({ ok: true, sent, forwarded, deleted })
}
