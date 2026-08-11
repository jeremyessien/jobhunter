import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { invokeClaude, ClaudeInvocationError } from '../src/claude.js'

const BIN = join(import.meta.dirname, 'fixtures', 'fake-claude.sh')
const schema = z.object({ score: z.number() })
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jh-claude-'))
  process.env.FAKE_CLAUDE_COUNTER = join(dir, 'count')
  delete process.env.FAKE_CLAUDE_OUTPUT_2
})

const envelope = (result: string) => JSON.stringify({ result })

function setOutput(name: 'FAKE_CLAUDE_OUTPUT' | 'FAKE_CLAUDE_OUTPUT_2', content: string) {
  const p = join(dir, name)
  writeFileSync(p, content)
  process.env[name] = p
}

describe('invokeClaude', () => {
  it('parses and validates a clean JSON response', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('{"score": 8}'))
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 8 })
  })

  it('extracts JSON wrapped in prose or code fences', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('Here you go:\n```json\n{"score": 6}\n```'))
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 6 })
  })

  it('retries once on invalid output, then succeeds', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('{"score": "high"}'))
    setOutput('FAKE_CLAUDE_OUTPUT_2', envelope('{"score": 7}'))
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 7 })
  })

  it('throws ClaudeInvocationError after two invalid outputs', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('not json at all'))
    await expect(
      invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN }),
    ).rejects.toThrow(ClaudeInvocationError)
  })
})
