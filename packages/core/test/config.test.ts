import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/config.js'

const validConfig = {
  lanes: [{ id: 'remote-mobile', titlePatterns: ['flutter', 'mobile'], rule: 'remote' }],
}

function writeTmp(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'jh-'))
  const p = join(dir, 'config.json')
  writeFileSync(p, JSON.stringify(obj))
  return p
}

describe('loadConfig', () => {
  it('parses a valid config and applies defaults', () => {
    const config = loadConfig(writeTmp(validConfig))
    expect(config.dbUrl).toBe('file:jobhunter.db')
    expect(config.scoreCapPerHunt).toBe(30)
    expect(config.queueThreshold).toBe(7)
    expect(config.companyCooldownDays).toBe(14)
    expect(config.draftCapPerHunt).toBe(10)
    expect(config.lanes[0].seniorityPatterns).toContain('senior')
    expect(config.visaPatterns.length).toBeGreaterThan(0)
  })

  it('rejects a config with no lanes', () => {
    expect(() => loadConfig(writeTmp({ lanes: [] }))).toThrow()
  })

  it('rejects an unknown lane rule', () => {
    expect(() =>
      loadConfig(writeTmp({ lanes: [{ id: 'x', titlePatterns: ['a'], rule: 'nope' }] })),
    ).toThrow()
  })
})
