import { getDb } from '../../../lib/db'
import { getJob } from '../../../lib/data'
import { approve, skip, snooze, submit, save } from './actions'
import { Nav } from '../../nav'

export const dynamic = 'force-dynamic'

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
          <p>Job not found.</p>
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
          <h2>
            {job.score !== null && `[${job.score}/10] `}
            {job.title}
            <span className="badge">{job.status}</span>
          </h2>
          <p className="meta">
            {job.company} · {job.lane} ·{' '}
            {/^https?:\/\//.test(job.applyUrl) ? <a href={job.applyUrl}>apply link</a> : job.applyUrl}
            {job.updatedAt && ` · posting updated ${job.updatedAt}`}
          </p>
          {job.verdict && <p>{job.verdict}</p>}
          {job.strengths.length > 0 && (
            <ul>
              {job.strengths.map((s, i) => (
                <li key={i}>
                  {s.claim} <span className="meta">({s.evidence})</span>
                </li>
              ))}
            </ul>
          )}
          {job.gaps.length > 0 && <p className="meta">gaps: {job.gaps.join('; ')}</p>}
        </div>

        {job.status === 'queued' && (
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
        )}

        {warnings.length > 0 && (
          <div className="warnings">
            <strong>Gate warnings (saved anyway):</strong>
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
          <h3>Cover letter {job.draftFlag === 'manual' && <span className="badge manual">write manually</span>}</h3>
          <textarea name="coverLetter" defaultValue={job.coverLetter ?? ''} />
          {job.answers.map((a, i) => (
            <div key={i}>
              <h4>{a.question}</h4>
              <input type="hidden" name={`q_${i}`} value={a.question} />
              <textarea name={`a_${i}`} defaultValue={a.answer} />
            </div>
          ))}
          <div className="actions">
            <button className="primary">Save draft</button>
          </div>
        </form>

        <h3>Job description</h3>
        <pre className="jd">{job.description}</pre>
      </main>
    </>
  )
}
