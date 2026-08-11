import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@jobhunter/core'
import { seedCompanies } from '../src/seed.js'

describe('seedCompanies', () => {
  it('imports rows and upserts on repeat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jh-'))
    const db = await openDb('file:' + join(dir, 't.db'))
    const csv = join(dir, 'seed.csv')
    writeFileSync(csv, 'ats,slug,name\ngreenhouse,stripe,Stripe\ngreenhouse,figma,Figma\n')
    expect(await seedCompanies(db, csv)).toBe(2)
    expect(await seedCompanies(db, csv)).toBe(2)
    const rs = await db.execute('SELECT COUNT(*) AS n FROM companies')
    expect(rs.rows[0].n).toBe(2)
  })
})
