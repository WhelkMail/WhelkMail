#!/usr/bin/env node
/**
 * Make sure worker/wrangler.toml exists and points at a real deployment.
 *
 * The cron worker config is personal (it contains the Pages URL), so it is
 * gitignored. `npm run cron:deploy` calls this first: it copies the committed
 * template when the file is missing and refuses to deploy while APP_URL is
 * still empty or a placeholder.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'worker', 'wrangler.toml')
const template = join(root, 'worker', 'wrangler.toml.example')

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

if (!existsSync(target)) {
  if (!existsSync(template)) {
    fail(`Missing ${template}. Restore it from the repository.`)
  }
  copyFileSync(template, target)
  console.log('Created worker/wrangler.toml from worker/wrangler.toml.example')
}

const config = readFileSync(target, 'utf8')
const match = /^\s*APP_URL\s*=\s*"([^"]*)"/m.exec(config)
if (!match) {
  fail('worker/wrangler.toml has no APP_URL entry. Copy worker/wrangler.toml.example again.')
}

const appUrl = match[1].trim()
const looksLikePlaceholder =
  appUrl === '' ||
  /your-project|example\.com|example\.pages\.dev|<.*>/i.test(appUrl) ||
  !/^https?:\/\//i.test(appUrl)

if (looksLikePlaceholder) {
  fail(
    [
      'worker/wrangler.toml still has a placeholder APP_URL.',
      'Set it to your Pages URL, for example:',
      '  APP_URL = "https://whelkmail.example.pages.dev"',
      `Then run npm run cron:deploy again (file: ${target}).`,
    ].join('\n'),
  )
}

// Normalise the URL so the cron fetch never ends up with a double slash.
const normalised = appUrl.replace(/\/+$/, '')
if (normalised !== appUrl) {
  writeFileSync(target, config.replace(match[0], `APP_URL = "${normalised}"`))
}
