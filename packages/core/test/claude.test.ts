import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
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

  it('ignores braces in trailing prose and succeeds on the first attempt', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('{"score": 5}\n\nNote: fields {score} explained above.'))
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 5 })
    expect(readFileSync(process.env.FAKE_CLAUDE_COUNTER!, 'utf8').trim()).toBe('1')
  })

  it('skips a non-JSON brace block preceding the real JSON', async () => {
    setOutput('FAKE_CLAUDE_OUTPUT', envelope('Sets look like {a, b}. Answer: {"score": 4}'))
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 4 })
    expect(readFileSync(process.env.FAKE_CLAUDE_COUNTER!, 'utf8').trim()).toBe('1')
  })

  it('does not miscount braces inside JSON string values', async () => {
    setOutput(
      'FAKE_CLAUDE_OUTPUT',
      envelope('Answer: {"score": 3, "verdict": "uses {braces} internally"} Done.'),
    )
    const out = await invokeClaude({ prompt: 'p', model: 'haiku', schema, claudeBin: BIN })
    expect(out).toEqual({ score: 3 })
  })
})
