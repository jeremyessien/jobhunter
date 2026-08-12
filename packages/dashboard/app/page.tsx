import Link from 'next/link'
import type { CSSProperties } from 'react'
import { getDb, getConfig } from '../lib/db'
import { queueJobs, queueOutlook } from '../lib/data'
import { Nav } from './nav'
import { timeAgo } from './format'

export const dynamic = 'force-dynamic'

export default async function QueuePage() {
  const db = await getDb()
  const jobs = await queueJobs(db, new Date().toISOString())
  const bar = getConfig().queueThreshold
  const outlook = jobs.length === 0 ? await queueOutlook(db) : null
  return (
    <>
      <Nav active="queue" />
      <main>
        <div className="page-head">
          <h1>Review</h1>
          <span className="sub">{jobs.length} to review</span>
        </div>
        <p className="desc">
          Jobs that matched your profile and scored at least {bar}/10, each with an application already drafted. Open
          one to read it and decide.
        </p>
        {outlook && (
          <div className="empty">
            <span className="status-dot" />
            <p>Nothing to review right now</p>
            {outlook.lastHuntAt === null ? (
              <p className="hint">
                no hunts have run yet — in a terminal, run <code>pnpm jobhunter hunt</code> to fetch and score jobs
              </p>
            ) : (
              <p className="hint">
                last hunt {timeAgo(outlook.lastHuntAt)} · {outlook.scoredCount} scored jobs sit below the {bar}/10 bar
                {outlook.bestScore !== null && ` (best ${outlook.bestScore}/10)`} · run <code>pnpm jobhunter hunt</code>{' '}
                for fresh postings
              </p>
            )}
            <p className="hint">
              <Link href="/how">how this works →</Link>
            </p>
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
                <span
                  className="ring"
                  title={`match score: ${j.score ?? '?'} of 10`}
                  style={{ '--p': String((j.score ?? 0) * 10) } as CSSProperties}
                >
                  <span>{j.score ?? '?'}</span>
                </span>
              </div>
              {j.verdict && <p className="meta">{j.verdict}</p>}
              <div className="chips">
                {j.draftFlag === 'drafted' && <span className="chip good">draft ready</span>}
                {j.draftFlag === 'manual' && <span className="chip warn">needs your own words</span>}
                {j.strengths.slice(0, 3).map((s, i) => (
                  <span key={i} className="chip good" title="why you fit">
                    {s.claim}
                  </span>
                ))}
                {j.strengths.length > 3 && <span className="chip">+{j.strengths.length - 3}</span>}
                {j.gaps.slice(0, 3).map((g, i) => (
                  <span key={i} className="chip gap" title="gap to be ready for">
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
