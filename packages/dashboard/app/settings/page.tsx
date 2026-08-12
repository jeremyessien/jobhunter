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
        <div className="page-head">
          <h1>Settings</h1>
          <span className="sub">{profile ? 'profile loaded' : 'no profile'}</span>
        </div>
        {saved && <p className="notice-ok">Saved.</p>}
        {error && <p className="notice-err">{error}</p>}

        <h2 className="section-title">Screening facts</h2>
        {!profile && (
          <div className="empty">
            <span className="status-dot" />
            <p>No profile yet</p>
            <p className="hint">run parse-resume first</p>
          </div>
        )}
        {profile && (
          <form action={saveScreening} className="card">
            <label className="field-label">Notice period</label>
            <input type="text" name="noticePeriod" defaultValue={screening.noticePeriod ?? ''} />
            <label className="field-label">Work authorization</label>
            <input type="text" name="workAuthorization" defaultValue={screening.workAuthorization ?? ''} />
            <label className="field-label">General salary expectation (fallback)</label>
            <input type="text" name="salaryExpectation" defaultValue={screening.salaryExpectation ?? ''} />
            <h3 className="section-title">Per-lane salary expectations</h3>
            {config.lanes.map((lane) => (
              <div key={lane.id}>
                <label className="field-label">{lane.id}</label>
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

        <h2 className="section-title">Config (lanes, blocklist)</h2>
        <form action={saveConfig} className="card">
          <textarea name="configText" className="mono" defaultValue={configText} style={{ minHeight: '16rem' }} />
          <div className="actions">
            <button className="primary">Validate and save</button>
          </div>
        </form>
      </main>
    </>
  )
}
