import { getDb, getConfig, configPath } from '../../lib/db'
import { getProfile } from '@jobhunter/hunter'
import { readFileSync } from 'node:fs'
import { saveScreening, saveConfig } from './actions'
import { Nav } from '../nav'

export const dynamic = 'force-dynamic'

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>
}) {
  const { saved, error } = await searchParams
  const db = await getDb()
  const profile = await getProfile(db)
  const config = getConfig()
  const configText = readFileSync(configPath, 'utf8')
  const screening = profile?.screening ?? {}
  return (
    <>
      <Nav active="settings" />
      <main>
        {saved && <p className="badge ready">Saved.</p>}
        {error && <p className="warnings">{error}</p>}

        <h2>Screening facts</h2>
        {!profile && <p>No profile yet — run parse-resume first.</p>}
        {profile && (
          <form action={saveScreening} className="card">
            <h4>Notice period</h4>
            <input type="text" name="noticePeriod" defaultValue={screening.noticePeriod ?? ''} />
            <h4>Work authorization</h4>
            <input type="text" name="workAuthorization" defaultValue={screening.workAuthorization ?? ''} />
            <h4>General salary expectation (fallback)</h4>
            <input type="text" name="salaryExpectation" defaultValue={screening.salaryExpectation ?? ''} />
            <h4>Per-lane salary expectations</h4>
            {config.lanes.map((lane) => (
              <div key={lane.id}>
                <label className="meta">{lane.id}</label>
                <input
                  type="text"
                  name={`salary_${lane.id}`}
                  defaultValue={screening.salaryExpectationsByLane?.[lane.id] ?? ''}
                />
              </div>
            ))}
            <div className="actions">
              <button className="primary">Save screening</button>
            </div>
          </form>
        )}

        <h2>Config (lanes, blocklist)</h2>
        <form action={saveConfig} className="card">
          <textarea name="configText" defaultValue={configText} style={{ minHeight: '16rem' }} />
          <div className="actions">
            <button className="primary">Validate and save</button>
          </div>
        </form>
      </main>
    </>
  )
}
