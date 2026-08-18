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
  draftCapPerHunt: z.number().int().positive().default(10),
  queueThreshold: z.number().int().min(1).max(10).default(7),
  companyCooldownDays: z.number().int().positive().default(14),
  resumePath: z.string().optional(),
  blocklist: z.array(z.string()).default([]),
  lanes: z.array(laneSchema).nonempty(),
  remoteExcludePatterns: z
    .array(z.string())
    .default(['US[- ]?only', 'United States only', 'EU only', 'UK only', 'US citizens?', 'based in the (US|EU|UK)']),
  visaPatterns: z
    .array(z.string())
    .default(['visa sponsorship', 'relocation (support|assistance|package)', 'work permit assistance', 'sponsorship (is )?available']),
  visaFriendlyLocations: z
    .array(z.string())
    .default([
      'germany', 'netherlands', 'ireland', 'portugal', 'spain', 'poland', 'sweden', 'denmark',
      'norway', 'finland', 'austria', 'belgium', 'switzerland', 'luxembourg', 'estonia',
      'czech', 'canada', 'united kingdom', 'united arab emirates', 'dubai', 'abu dhabi',
      'berlin', 'munich', 'münchen', 'hamburg', 'stuttgart', 'amsterdam', 'dublin',
      'lisbon', 'barcelona', 'madrid', 'warsaw', 'stockholm', 'copenhagen', 'vienna',
      'zurich', 'toronto', 'vancouver', 'london',
    ]),
  excludeTitlePatterns: z
    .array(z.string())
    .default([
      'junior', 'intern(ship)?\\b', 'graduate', 'trainee', 'apprentice', 'werkstudent',
      'working student', 'entry[- ]level', 'praktikum', 'praktikant',
    ]),
})

export type Config = z.infer<typeof configSchema>
export type Lane = z.infer<typeof laneSchema>

export function loadConfig(path = 'jobhunter.config.json'): Config {
  return configSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
