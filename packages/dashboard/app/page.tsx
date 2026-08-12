import Link from 'next/link'
import type { CSSProperties } from 'react'
import { getDb } from '../lib/db'
import { queueJobs } from '../lib/data'
import { Nav } from './nav'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const db = await getDb()
  const jobs = await queueJobs(db, new Date().toISOString())
  return (
    <>
      <Nav active="queue" />
      <main>
        <div className="page-head">
          <h1>Queue</h1>
          <span className="sub">{jobs.length} waiting</span>
        </div>
        {jobs.length === 0 && (
          <div className="empty">
            <span className="status-dot" />
            <p>Queue is empty</p>
            <p className="hint">run a hunt to fill it</p>
          </div>
        )}
        <div className="queue-list">
          {jobs.map((j) => (
            <div className="card" key={j.id}>
              <div className="queue-row">
                <div>
                  <h2>
                    <Link className="card-link" href={`/job/${j.id}`}>
                      {j.title}
                    </Link>
                  </h2>
                  <p className="meta">
                    <span className="status-dot" /> {j.company.toUpperCase()} · {j.lane ?? 'no lane'}
                  </p>
                </div>
                <span className="ring" style={{ '--p': String((j.score ?? 0) * 10) } as CSSProperties}>
                  <span>{j.score ?? '?'}</span>
                </span>
              </div>
              {j.verdict && <p className="meta">{j.verdict}</p>}
              <div className="chips">
                {j.draftFlag === 'drafted' && <span className="chip good">draft ready</span>}
                {j.draftFlag === 'manual' && <span className="chip warn">write manually</span>}
                {j.strengths.slice(0, 3).map((s, i) => (
                  <span key={i} className="chip good">
                    {s.claim}
                  </span>
                ))}
                {j.strengths.length > 3 && <span className="chip">+{j.strengths.length - 3}</span>}
                {j.gaps.slice(0, 3).map((g, i) => (
                  <span key={i} className="chip gap">
                    {g}
                  </span>
                ))}
                {j.gaps.length > 3 && <span className="chip">+{j.gaps.length - 3}</span>}
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  )
}
