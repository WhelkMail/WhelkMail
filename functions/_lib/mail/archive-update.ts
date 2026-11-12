import type { Env } from '../env'

/**
 * The single statement that marks a message as archived.
 *
 * Both sync paths (newly ingested messages and the pending-archive pass) must
 * record the backend next to the object key: an account can switch between R2
 * and Drive, and reading or pruning an archived body uses the driver that wrote
 * it. Keeping the SQL in one constant means a new path cannot forget a column.
 */
export const ARCHIVE_UPDATE_SQL =
  'UPDATE imap_messages SET archived = 1, archive_key = ?, archive_driver = ? WHERE id = ?'

/**
 * Prepared statement for one archived message. Both sync paths call this, so the
 * key, the driver and the id always travel together.
 */
export function archiveUpdateStatement(
  env: Env,
  input: { id: string; key: string; driver: string },
): D1PreparedStatement {
  return env.DB.prepare(ARCHIVE_UPDATE_SQL).bind(input.key, input.driver, input.id)
}
