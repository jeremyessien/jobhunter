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
        <p className="desc">
          Your facts and preferences. Drafts can only use what is saved here or what is written in the job posting —
          nothing else.
        </p>
        {saved && <p className="notice-ok">Saved.</p>}
        {error && <p className="notice-err">{error}</p>}

        <h2 className="section-title">Screening facts</h2>
        <p className="desc">Standard answers reused across applications — notice period, work authorization, salary.</p>
        {!profile && (
          <div className="empty">
            <span className="status-dot" />
            <p>No profile yet</p>
            <p className="hint">
              in a terminal, run <code>pnpm jobhunter parse-resume path/to/resume.pdf</code> — the resume becomes the
              fact source for every draft
            </p>
          </div>
        )}
        {profile && (
          <form action={saveScreening} className="card">
            <label className="field-label" htmlFor="noticePeriod">Notice period</label>
            <input type="text" id="noticePeriod" name="noticePeriod" defaultValue={screening.noticePeriod ?? ''} />
            <label className="field-label" htmlFor="workAuthorization">Work authorization</label>
            <input type="text" id="workAuthorization" name="workAuthorization" defaultValue={screening.workAuthorization ?? ''} />
            <label className="field-label" htmlFor="salaryExpectation">General salary expectation (fallback)</label>
            <input type="text" id="salaryExpectation" name="salaryExpectation" defaultValue={screening.salaryExpectation ?? ''} />
            <h3 className="section-title">Per-lane salary expectations</h3>
            <p className="desc">
              Lanes are your parallel search tracks. Set an expectation per lane; leave one blank to fall back to the
              general number above.
            </p>
            {config.lanes.map((lane) => (
              <div key={lane.id}>
                <label className="field-label" htmlFor={`salary_${lane.id}`}>{lane.id}</label>
                <input
                  type="text"
                  id={`salary_${lane.id}`}
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

        <h2 className="section-title">Config (lanes, blocklist, review bar)</h2>
        <p className="desc">
          The raw configuration: which job titles each lane matches, companies to never apply to,{' '}
          <span className="mono">queueThreshold</span> — the 0–10 score a job needs to reach Review — and{' '}
          <span className="mono">resumePath</span>, the PDF attached to every application. Checked for mistakes before
          saving.
        </p>
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
