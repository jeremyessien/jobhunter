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
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('no JSON object found in response')
  return JSON.parse(text.slice(start, end + 1))
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
