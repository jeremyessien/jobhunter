import { loadConfig, openDb, invokeClaude, makeThrottledFetch } from '@jobhunter/core'
import { hunt } from './hunt'
import { greenhouseAdapter } from './sources/greenhouse'
import { remotiveAdapter } from './sources/remotive'
import { parseResume, getProfile } from './profile'
import { seedCompanies } from './seed'
import { listQueue } from './queue'
import { runDrafter } from './pipeline/drafter'

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
    console.log(result.draft ? `draft: ${result.draft.drafted} drafted, ${result.draft.manual} manual, ${result.draft.deferred} deferred` : 'draft skipped: run parse-resume first')
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
  case 'draft': {
    const profile = await getProfile(db)
    if (!profile) throw new Error('no profile stored: run parse-resume first')
    const res = await runDrafter({ db, config, profile, invoke: invokeClaude, fetchJson: makeThrottledFetch() })
    console.log(`draft: ${res.drafted} drafted, ${res.manual} manual, ${res.deferred} deferred`)
    break
  }
  case 'apply': {
    const { runApply } = await import('@jobhunter/applier')
    await runApply(db, config)
    break
  }
  default:
    console.log('usage: jobhunter <hunt|parse-resume|seed-companies|queue|draft|apply>')
}
