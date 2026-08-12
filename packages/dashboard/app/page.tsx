import Link from 'next/link'
import { getDb } from '../lib/db'
import { queueJobs } from '../lib/data'
import { Nav } from './nav'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const db = await getDb()
  const jobs = await queueJobs(db, new Date().toISOString())
  if (jobs.length === 0)
    return (
      <>
        <Nav active="queue" />
        <main>
          <p>Queue is empty. Run a hunt.</p>
        </main>
      </>
    )
  return (
    <>
      <Nav active="queue" />
      <main>
        {jobs.map((j) => (
          <div className="card" key={j.id}>
            <h2>
              <Link href={`/job/${j.id}`}>
                {j.score !== null && `[${j.score}/10] `}
                {j.title}
              </Link>
              {j.draftFlag === 'drafted' && <span className="badge ready">draft ready</span>}
              {j.draftFlag === 'manual' && <span className="badge manual">write manually</span>}
            </h2>
            <p className="meta">
              {j.company} · {j.lane}
            </p>
            {j.verdict && <p>{j.verdict}</p>}
            {j.gaps.length > 0 && <p className="meta">gaps: {j.gaps.join('; ')}</p>}
          </div>
        ))}
      </main>
    </>
  )
}
