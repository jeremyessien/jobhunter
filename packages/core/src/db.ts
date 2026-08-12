import { createClient, type Client } from '@libsql/client'

const MIGRATIONS = [
  `CREATE TABLE companies(
    id INTEGER PRIMARY KEY,
    ats TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT,
    last_seen TEXT,
    UNIQUE(ats, slug)
  )`,
  `CREATE TABLE jobs(
    id INTEGER PRIMARY KEY,
    external_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    remote INTEGER DEFAULT 0,
    salary TEXT,
    description TEXT NOT NULL,
    apply_url TEXT NOT NULL,
    source TEXT NOT NULL,
    ats_family TEXT,
    lane TEXT,
    posted_at TEXT,
    first_seen TEXT NOT NULL,
    updated_at TEXT,
    status TEXT NOT NULL DEFAULT 'sourced',
    score INTEGER,
    score_json TEXT,
    cover_letter TEXT,
    answers_json TEXT,
    draft_flag TEXT,
    submitted_at TEXT,
    responded_at TEXT
  )`,
  `CREATE TABLE runs(
    id INTEGER PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    source TEXT NOT NULL,
    ok INTEGER,
    error TEXT,
    jobs_found INTEGER
  )`,
  `CREATE TABLE profile(
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `ALTER TABLE jobs ADD COLUMN snoozed_until TEXT`,
]

export async function openDb(url: string, authToken?: string): Promise<Client> {
  const db = createClient({ url, authToken })
  await db.execute('CREATE TABLE IF NOT EXISTS schema_version(v INTEGER NOT NULL)')
  const rs = await db.execute('SELECT MAX(v) AS v FROM schema_version')
  const current = (rs.rows[0]?.v as number | null) ?? 0
  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.batch(
      [MIGRATIONS[i], { sql: 'INSERT INTO schema_version(v) VALUES (?)', args: [i + 1] }],
      'write',
    )
  }
  return db
}
