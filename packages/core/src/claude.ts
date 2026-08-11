import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ZodType } from 'zod'

const exec = promisify(execFile)

export class ClaudeInvocationError extends Error {}

export type InvokeClaude = <T>(opts: {
  prompt: string
  model: 'haiku' | 'sonnet'
  schema: ZodType<T>
  claudeBin?: string
  allowedTools?: string[]
}) => Promise<T>

function extractJson(text: string): unknown {
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          // candidate wasn't valid JSON after all; keep scanning for the next one
        }
      }
    }
  }
  throw new Error('no JSON object found in response')
}

async function callOnce(prompt: string, model: string, bin: string, allowedTools?: string[]) {
  const args = ['-p', prompt, '--model', model, '--output-format', 'json']
  if (allowedTools?.length) args.push('--allowedTools', allowedTools.join(','))
  const { stdout } = await exec(bin, args, { maxBuffer: 32 * 1024 * 1024 })
  const envelope = JSON.parse(stdout) as { result?: string }
  if (typeof envelope.result !== 'string') throw new Error('missing result in claude output')
  return envelope.result
}

export const invokeClaude: InvokeClaude = async ({ prompt, model, schema, claudeBin = 'claude', allowedTools }) => {
  let lastError: unknown
  let currentPrompt = prompt
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callOnce(currentPrompt, model, claudeBin, allowedTools)
      return schema.parse(extractJson(result))
    } catch (err) {
      lastError = err
      currentPrompt = `${prompt}\n\nYour previous reply failed validation: ${String(err)}\nReply with ONLY a valid JSON object matching the schema. No prose, no code fences.`
    }
  }
  throw new ClaudeInvocationError(`claude invocation failed after retry: ${String(lastError)}`)
}
