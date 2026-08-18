import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const env = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

describe('getDb', () => {
  const original = {
    url: process.env.JOBHUNTER_DB_URL,
    token: process.env.JOBHUNTER_DB_AUTH_TOKEN,
    root: process.env.JOBHUNTER_ROOT,
  }

  afterEach(() => {
    env('JOBHUNTER_DB_URL', original.url)
    env('JOBHUNTER_DB_AUTH_TOKEN', original.token)
    env('JOBHUNTER_ROOT', original.root)
  })

  it('clears the cached promise on rejection so a later call can retry', async () => {
    process.env.JOBHUNTER_DB_URL = 'not-a-real-scheme://x'
    vi.resetModules()
    const { getDb } = await import('../lib/db.js')

    await expect(getDb()).rejects.toThrow()

    process.env.JOBHUNTER_DB_URL = 'file:' + join(mkdtempSync(join(tmpdir(), 'jh-db-')), 't.db')
    await expect(getDb()).resolves.toBeDefined()
  })

  it('falls back to the repo database when no url is set', async () => {
    delete process.env.JOBHUNTER_DB_URL
    process.env.JOBHUNTER_ROOT = mkdtempSync(join(tmpdir(), 'jh-root-'))
    vi.resetModules()
    const { getDb } = await import('../lib/db.js')
    await expect(getDb()).resolves.toBeDefined()
  })
})

describe('getConfig', () => {
  const original = process.env.JOBHUNTER_DB_URL
  afterEach(() => env('JOBHUNTER_DB_URL', original))

  it('reads config from the database, not the filesystem', async () => {
    process.env.JOBHUNTER_DB_URL = 'file:' + join(mkdtempSync(join(tmpdir(), 'jh-cfg-')), 't.db')
    vi.resetModules()
    const { getDb, getConfig } = await import('../lib/db.js')
    const { saveConfigToDb, configSchema } = await import('@jobhunter/core')

    await saveConfigToDb(
      await getDb(),
      configSchema.parse({ lanes: [{ id: 'l', titlePatterns: ['x'], rule: 'any' }], queueThreshold: 4 }),
    )
    expect((await getConfig()).queueThreshold).toBe(4)
  })

  it('explains how to recover when the database holds no config', async () => {
    process.env.JOBHUNTER_DB_URL = 'file:' + join(mkdtempSync(join(tmpdir(), 'jh-empty-')), 't.db')
    vi.resetModules()
    const { getConfig } = await import('../lib/db.js')
    await expect(getConfig()).rejects.toThrow(/seed-config/)
  })
})
