import { readFileSync } from 'node:fs'
import { z } from 'zod'

const laneSchema = z.object({
  id: z.string(),
  titlePatterns: z.array(z.string()).nonempty(),
  seniorityPatterns: z.array(z.string()).default(['senior', 'staff', 'lead', 'principal']),
  rule: z.enum(['remote', 'visa', 'nigeria', 'any']),
})

export const configSchema = z.object({
  dbUrl: z.string().default('file:jobhunter.db'),
  dbAuthToken: z.string().optional(),
  claudeBin: z.string().default('claude'),
  scoreCapPerHunt: z.number().int().positive().default(30),
  queueThreshold: z.number().int().min(1).max(10).default(7),
  companyCooldownDays: z.number().int().positive().default(14),
  blocklist: z.array(z.string()).default([]),
  lanes: z.array(laneSchema).nonempty(),
  remoteExcludePatterns: z
    .array(z.string())
    .default(['US[- ]?only', 'United States only', 'EU only', 'UK only', 'US citizens?', 'based in the (US|EU|UK)']),
  visaPatterns: z
    .array(z.string())
    .default(['visa sponsorship', 'relocation (support|assistance|package)', 'work permit assistance', 'sponsorship (is )?available']),
})

export type Config = z.infer<typeof configSchema>
export type Lane = z.infer<typeof laneSchema>

export function loadConfig(path = 'jobhunter.config.json'): Config {
  return configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
