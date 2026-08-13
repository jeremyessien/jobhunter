import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/db.js'
import { parseGreenhouseUrl, resolveGreenhouseRef } from '../src/greenhouse.js'

const tmpDb = () => openDb('file:' + join(mkdtempSync(join(tmpdir(), 'jh-')), 't.db'))

describe('parseGreenhouseUrl', () => {
  it('extracts slug and id from hosted board urls', () => {
    expect(parseGreenhouseUrl('https://job-boards.greenhouse.io/twilio/jobs/8039842')).toEqual({
      slug: 'twilio',
      id: '8039842',
    })
  })
  it('returns null for custom career domains', () => {
    expect(parseGreenhouseUrl('https://www.coinbase.com/careers/positions/1?gh_jid=1')).toBeNull()
  })
})

describe('resolveGreenhouseRef', () => {
  it('resolves from the url when possible', async () => {
    const db = await tmpDb()
    const ref = await resolveGreenhouseRef(db, {
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/7',
      externalKey: 'greenhouse:7',
      company: 'Acme',
    })
    expect(ref).toEqual({ slug: 'acme', id: '7' })
  })
  it('falls back to external key and the companies table', async () => {
    const db = await tmpDb()
    await db.execute("INSERT INTO companies(ats, slug, name) VALUES ('greenhouse', 'brex', 'BREX')")
    const ref = await resolveGreenhouseRef(db, {
      applyUrl: 'https://www.brex.com/careers/9',
      externalKey: 'greenhouse:9',
      company: 'brex',
    })
    expect(ref).toEqual({ slug: 'brex', id: '9' })
  })
  it('returns null for unknown companies and non-greenhouse keys', async () => {
    const db = await tmpDb()
    expect(
      await resolveGreenhouseRef(db, { applyUrl: 'https://x.dev/1', externalKey: 'greenhouse:1', company: 'Nobody' }),
    ).toBeNull()
    expect(
      await resolveGreenhouseRef(db, { applyUrl: 'https://x.dev/1', externalKey: 'remotive:1', company: 'Acme' }),
    ).toBeNull()
  })
})
