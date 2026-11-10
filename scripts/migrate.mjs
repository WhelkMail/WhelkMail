#!/usr/bin/env node
/**
 * Apply the SQL migrations in db/migrations in filename order.
 *
 *   node scripts/migrate.mjs local            # local D1 (miniflare)
 *   node scripts/migrate.mjs remote           # remote D1 of the account
 *   node scripts/migrate.mjs remote --from=013
 *
 * Migrations are additive ALTER/CREATE statements, not idempotent: a fresh
 * database only needs db/schema.sql, which already contains every column.
 * Use this script to upgrade a database created by an older version.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const target = args.find((arg) => !arg.startsWith('--')) ?? 'local'
if (target !== 'local' && target !== 'remote') {
  console.error(`Unknown target "${target}". Use "local" or "remote".`)
  process.exit(1)
}
const fromArg = args.find((arg) => arg.startsWith('--from='))
const from = fromArg ? fromArg.slice('--from='.length).padStart(3, '0') : '000'

const database = process.env.WHELKMAIL_D1_NAME ?? 'mail-client'
const migrations = readdirSync(join(root, 'db', 'migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .filter((file) => file.slice(0, 3) >= from)

if (migrations.length === 0) {
  console.log(`No migrations found at or after ${from}.`)
  process.exit(0)
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
for (const file of migrations) {
  const relative = `./db/migrations/${file}`
  console.log(`\n[db] ${relative} -> ${target}`)
  const result = spawnSync(
    npx,
    ['wrangler', 'd1', 'execute', database, `--${target}`, `--file=${relative}`],
    { cwd: root, stdio: 'inherit' },
  )
  if (result.status !== 0) {
    console.error(
      `\n[db] ${file} failed. Migrations before it are already applied; fix the error and rerun with --from=${file.slice(0, 3)}.`,
    )
    process.exit(result.status ?? 1)
  }
}

console.log(`\n[db] applied ${migrations.length} migration(s) to ${target}.`)
