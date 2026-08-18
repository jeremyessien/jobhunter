import { readFileSync } from 'node:fs'
import type { Client } from '@libsql/client'
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

export async function loadConfigFromDb(db: Client): Promise<Config> {
  const rs = await db.execute('SELECT json FROM config WHERE id=1')
  if (rs.rows.length === 0) {
    throw new Error('no config stored: run `jobhunter seed-config` to load jobhunter.config.json into the database')
  }
  return configSchema.parse(JSON.parse(String(rs.rows[0].json)))
}

export async function saveConfigToDb(db: Client, config: Config): Promise<void> {
  await db.execute({
    sql: `INSERT INTO config(id, json, updated_at) VALUES (1, ?, datetime('now'))
          ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`,
    args: [JSON.stringify(config)],
  })
}

export async function seedConfigFromFile(db: Client, path = 'jobhunter.config.json'): Promise<Config> {
  const rs = await db.execute('SELECT json FROM config WHERE id=1')
  if (rs.rows.length > 0) return configSchema.parse(JSON.parse(String(rs.rows[0].json)))
  const config = loadConfig(path)
  await saveConfigToDb(db, config)
  return config
}
