import type { CSSProperties } from 'react'
import { getDb } from '../../../lib/db'
import { getJob } from '../../../lib/data'
import { approve, skip, snooze, submit, save } from './actions'
import { Nav } from '../../nav'
import { timeAgo } from '../../format'

export const dynamic = 'force-dynamic'

const statusChip: Record<string, string> = {
  queued: 'chip warn',
  approved: 'chip good',
  submitted: 'chip info',
  responded: 'chip good',
  rejected: 'chip gap',
}

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ warnings?: string }>
}) {
  const { id } = await params
  const { warnings: warningsParam } = await searchParams
  const db = await getDb()
  const job = await getJob(db, Number(id))
  if (!job)
    return (
      <>
        <Nav active="queue" />
        <main>
          <div className="empty">
            <span className="status-dot bad" />
            <p>Job not found</p>
          </div>
        </main>
      </>
    )
  let warnings: string[] = []
  try {
    const parsed = JSON.parse(warningsParam ?? '[]')
    if (Array.isArray(parsed)) warnings = parsed.map(String)
  } catch {}
  return (
    <>
      <Nav active="queue" />
      <main>
        <div className="card">
          <div className="queue-row">
            <div>
              <h2>{job.title}</h2>
              <p className="meta">
                <span className={statusChip[job.status] ?? 'chip'}>{job.status}</span>{' '}
                {job.company.toUpperCase()} · {job.lane ?? 'no lane'} ·{' '}
                {/^https?:\/\//.test(job.applyUrl) ? <a href={job.applyUrl}>apply link</a> : job.applyUrl}
                {job.updatedAt && <> · updated <span className="mono">{timeAgo(job.updatedAt)}</span></>}
              </p>
            </div>
            <span className="ring" style={{ '--p': String((job.score ?? 0) * 10) } as CSSProperties}>
              <span>{job.score ?? '?'}</span>
            </span>
          </div>
          {job.verdict && <p className="meta">{job.verdict}</p>}
          {job.strengths.length > 0 && (
            <>
              <h3 className="section-title">Why you fit</h3>
              <ul>
                {job.strengths.map((s, i) => (
                  <li key={i}>
                    {s.claim} <span className="meta">({s.evidence})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {job.gaps.length > 0 && (
            <>
              <h3 className="section-title">Gaps to be ready for</h3>
              <div className="chips">
                {job.gaps.map((g, i) => (
                  <span key={i} className="chip gap">
                    {g}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="job-grid">
          <div className="jd-panel">
            <details className="jd-details" open>
              <summary>The full posting</summary>
              <pre className="jd">{job.description}</pre>
            </details>
          </div>
          <div>
            {warnings.length > 0 && (
              <div className="warnings">
                <strong>Heads-up — your edits were saved anyway</strong>
                <p className="desc">
                  Automatic checks flagged the points below. Your words always win; fix them only if they are right.
                </p>
                <ul>
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <form action={save}>
              <input type="hidden" name="id" value={job.id} />
              <input type="hidden" name="answerCount" value={job.answers.length} />
              <h3 className="section-title">
                Cover letter {job.draftFlag === 'manual' && <span className="chip warn">needs your own words</span>}
              </h3>
              <p className="desc">
                Drafted from your profile and this posting only — it cannot invent facts. Edit freely; your edits are
                never overwritten.
              </p>
              <textarea name="coverLetter" defaultValue={job.coverLetter ?? ''} />
              {job.answers.map((a, i) => (
                <div key={i}>
                  <label className="field-label" htmlFor={`a_${i}`}>{a.question}</label>
                  <input type="hidden" name={`q_${i}`} value={a.question} />
                  <textarea id={`a_${i}`} name={`a_${i}`} defaultValue={a.answer} />
                </div>
              ))}
              <div className="actions">
                <button className="primary">Save draft</button>
              </div>
            </form>

            {job.status === 'queued' && (
              <div className="action-bar">
                <p className="desc action-help">
                  Approve = you plan to apply · Skip = never show this job again · Snooze = hide it for a few days.
                  After you apply on the company site, come back and hit Mark submitted.
                </p>
                <div className="actions">
                  <form action={approve}>
                    <input type="hidden" name="id" value={job.id} />
                    <button className="primary">Approve</button>
                  </form>
                  <form action={skip}>
                    <input type="hidden" name="id" value={job.id} />
                    <button>Skip</button>
                  </form>
                  <form action={snooze} className="actions">
                    <input type="hidden" name="id" value={job.id} />
                    <select name="days" defaultValue="3">
                      <option value="1">1 day</option>
                      <option value="3">3 days</option>
                      <option value="7">7 days</option>
                    </select>
                    <button>Snooze</button>
                  </form>
                  <form action={submit}>
                    <input type="hidden" name="id" value={job.id} />
                    <button>Mark submitted</button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  )
}
