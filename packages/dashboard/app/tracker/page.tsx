import { getDb } from '../../lib/db'
import { trackerJobs, laneStats } from '../../lib/data'
import { respond, reject } from './actions'
import { Nav } from '../nav'
import { timeAgo } from '../format'
import { requireSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

const statusChip: Record<string, string> = {
  responded: 'chip good',
  rejected: 'chip gap',
  submitted: 'chip info',
}

export default async function TrackerPage() {
  await requireSession()
  const db = await getDb()
  const [jobs, stats] = await Promise.all([trackerJobs(db), laneStats(db)])
  const responded = jobs.filter((j) => j.status === 'responded').length
  const rejected = jobs.filter((j) => j.status === 'rejected').length
  const rate = jobs.length > 0 ? Math.round((responded / jobs.length) * 100) : 0
  return (
    <>
      <Nav active="tracker" />
      <main>
        <div className="page-head">
          <h1>Applications</h1>
          <span className="sub">{jobs.length} sent</span>
        </div>
        <p className="desc">
          Everything you have marked as submitted, and how each one is going. Tag replies here so the response rates
          mean something.
        </p>
        <div className="stats">
          <div className="stat">
            <div className="num">{jobs.length}</div>
            <div className="label">submitted</div>
          </div>
          <div className="stat">
            <div className="num">{responded}</div>
            <div className="label">responded</div>
          </div>
          <div className="stat">
            <div className="num">{rejected}</div>
            <div className="label">rejected</div>
          </div>
          <div className="stat">
            <div className="num">{rate}%</div>
            <div className="label">response rate</div>
          </div>
        </div>
        {jobs.length === 0 && (
          <div className="empty">
            <span className="status-dot" />
            <p>Nothing submitted yet</p>
            <p className="hint">
              approve a job in Review, apply on the company site, then hit Mark submitted on the job&apos;s page — it
              shows up here
            </p>
          </div>
        )}
        {jobs.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    {j.title}
                    <div className="meta">
                      {j.company} · {j.lane ?? 'no lane'} · sent{' '}
                      <span className="mono">{j.submittedAt ? timeAgo(j.submittedAt) : '?'}</span>
                    </div>
                  </td>
                  <td>
                    <span className={statusChip[j.status] ?? 'chip'}>{j.status}</span>
                  </td>
                  <td>
                    {j.status === 'submitted' && (
                      <div className="actions">
                        <form action={respond}>
                          <input type="hidden" name="id" value={j.id} />
                          <button>Responded</button>
                        </form>
                        <form action={reject}>
                          <input type="hidden" name="id" value={j.id} />
                          <button>Rejected</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {stats.length > 0 && (
          <>
            <h2 className="section-title">Response rate by lane</h2>
            <p className="desc">A lane is one of your parallel search tracks — this shows which track actually converts.</p>
            <table>
              <thead>
                <tr>
                  <th>Lane</th>
                  <th>Submitted</th>
                  <th>Responded</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.lane}>
                    <td>{s.lane}</td>
                    <td className="mono">{s.submitted}</td>
                    <td className="mono">{s.responded}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </main>
    </>
  )
}
