import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { listQueue } from '../src/queue.js'

describe('listQueue', () => {
  it('lists queued jobs highest score first', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    const insert = (key: string, title: string, score: number, status: string) =>
      db.execute({
        sql: `INSERT INTO jobs(external_key, title, company, description, apply_url, source, first_seen, status, score, lane)
              VALUES (?,?,?,?,?,?,?,?,?,?)`,
        args: [key, title, 'Acme', 'd', `https://x/${key}`, 's', '2026-08-11', status, score, 'remote-mobile'],
      })
    await insert('a:1', 'Senior Flutter Engineer', 8, 'queued')
    await insert('a:2', 'Senior Mobile Engineer', 9, 'queued')
    await insert('a:3', 'Senior React Engineer', 9, 'scored')

    const lines = await listQueue(db)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('[9/10] Senior Mobile Engineer — Acme (remote-mobile) https://x/a:2')
    expect(lines[1]).toBe('[8/10] Senior Flutter Engineer — Acme (remote-mobile) https://x/a:1')
  })

  it('returns an empty list when nothing is queued', async () => {
    const db = await openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))
    expect(await listQueue(db)).toEqual([])
  })
})
