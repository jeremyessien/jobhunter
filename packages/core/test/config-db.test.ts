import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'
import { configSchema, loadConfigFromDb, saveConfigToDb, seedConfigFromFile } from '../src/config.js'

const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

const sample = {
  lanes: [{ id: 'remote-mobile', titlePatterns: ['flutter'], rule: 'remote' as const }],
  queueThreshold: 6,
}

const writeConfigFile = (body: unknown) => {
  const path = join(mkdtempSync(join(tmpdir(), 'jh-cfg-')), 'jobhunter.config.json')
  writeFileSync(path, JSON.stringify(body))
  return path
}

describe('config stored in the database', () => {
  it('round-trips a saved config', async () => {
    const db = await tmpDb()
    await saveConfigToDb(db, configSchema.parse(sample))
    const loaded = await loadConfigFromDb(db)
    expect(loaded.queueThreshold).toBe(6)
    expect(loaded.lanes[0].id).toBe('remote-mobile')
  })

  it('applies schema defaults on load', async () => {
    const db = await tmpDb()
    await saveConfigToDb(db, configSchema.parse(sample))
    const loaded = await loadConfigFromDb(db)
    expect(loaded.claudeBin).toBe('claude')
    expect(loaded.draftCapPerHunt).toBe(10)
    expect(loaded.excludeTitlePatterns.length).toBeGreaterThan(0)
  })

  it('overwrites rather than accumulating rows', async () => {
    const db = await tmpDb()
    await saveConfigToDb(db, configSchema.parse(sample))
    await saveConfigToDb(db, configSchema.parse({ ...sample, queueThreshold: 9 }))
    const rs = await db.execute('SELECT COUNT(*) AS n FROM config')
    expect(rs.rows[0].n).toBe(1)
    expect((await loadConfigFromDb(db)).queueThreshold).toBe(9)
  })

  it('names the recovery command when nothing is stored', async () => {
    const db = await tmpDb()
    await expect(loadConfigFromDb(db)).rejects.toThrow(/seed-config/)
  })

  it('seeds from the file when the table is empty', async () => {
    const db = await tmpDb()
    const seeded = await seedConfigFromFile(db, writeConfigFile(sample))
    expect(seeded.queueThreshold).toBe(6)
    expect((await loadConfigFromDb(db)).queueThreshold).toBe(6)
  })

  it('never overwrites a stored config on a later seed', async () => {
    const db = await tmpDb()
    const path = writeConfigFile(sample)
    await seedConfigFromFile(db, path)
    await saveConfigToDb(db, configSchema.parse({ ...sample, queueThreshold: 9 }))
    const after = await seedConfigFromFile(db, path)
    expect(after.queueThreshold).toBe(9)
  })

  it('rejects a stored config that no longer satisfies the schema', async () => {
    const db = await tmpDb()
    await db.execute({
      sql: "INSERT INTO config(id, json, updated_at) VALUES (1, ?, datetime('now'))",
      args: [JSON.stringify({ lanes: [] })],
    })
    await expect(loadConfigFromDb(db)).rejects.toThrow()
  })
})
