import { loadConfig, openDb, invokeClaude } from '@jobhunter/core'
import { hunt } from './hunt.js'
import { greenhouseAdapter } from './sources/greenhouse.js'
import { remotiveAdapter } from './sources/remotive.js'
import { makeThrottledFetch } from './net.js'
import { parseResume } from './profile.js'
import { seedCompanies } from './seed.js'
import { listQueue } from './queue.js'

const [command, arg] = process.argv.slice(2)

const config = loadConfig()
const db = await openDb(config.dbUrl, config.dbAuthToken)

switch (command) {
  case 'hunt': {
    const result = await hunt({
      db,
      config,
      adapters: [greenhouseAdapter, remotiveAdapter],
      invoke: invokeClaude,
      fetchJson: makeThrottledFetch(),
      now: new Date().toISOString(),
    })
    for (const r of result.runs) console.log(`${r.ok ? 'ok ' : 'ERR'} ${r.source}: ${r.jobsFound} jobs`)
    console.log(`filter: ${result.filter.matched} matched, ${result.filter.filteredOut} out`)
    console.log(result.judge ? `judge: ${result.judge.scored} scored, ${result.judge.queued} queued, ${result.judge.failed} failed` : 'judge skipped: run parse-resume first')
    break
  }
  case 'parse-resume': {
    if (!arg) throw new Error('usage: jobhunter parse-resume <pdf-path>')
    const profile = await parseResume(db, arg, config, invokeClaude)
    console.log(`profile stored for ${profile.name} (${profile.skills.length} skills, ${profile.experience.length} roles)`)
    break
  }
  case 'seed-companies': {
    if (!arg) throw new Error('usage: jobhunter seed-companies <csv-path>')
    console.log(`seeded ${await seedCompanies(db, arg)} companies`)
    break
  }
  case 'queue': {
    for (const line of await listQueue(db)) console.log(line)
    break
  }
  default:
    console.log('usage: jobhunter <hunt|parse-resume|seed-companies|queue>')
}
