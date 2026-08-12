import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseConfig = { lanes: [{ id: 'l', titlePatterns: ['x'], rule: 'any' }] }

describe('getDb', () => {
  const originalRoot = process.env.JOBHUNTER_ROOT

  afterEach(() => {
    if (originalRoot === undefined) delete process.env.JOBHUNTER_ROOT
    else process.env.JOBHUNTER_ROOT = originalRoot
  })

  it('clears the cached promise on rejection so a later call can retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-db-'))
    const configPath = join(dir, 'jobhunter.config.json')
    writeFileSync(configPath, JSON.stringify({ ...baseConfig, dbUrl: 'not-a-real-scheme://x' }))
    process.env.JOBHUNTER_ROOT = dir

    vi.resetModules()
    const { getDb } = await import('../lib/db.js')

    await expect(getDb()).rejects.toThrow()

    writeFileSync(configPath, JSON.stringify({ ...baseConfig, dbUrl: 'file:' + join(dir, 't.db') }))
    await expect(getDb()).resolves.toBeDefined()
  })
})
