import Link from 'next/link'
import type { CSSProperties } from 'react'
import { getDb, getConfig } from '../lib/db'
import { queueJobs, queueOutlook, type QueueItem } from '../lib/data'
import { Nav } from './nav'
import { timeAgo } from './format'
import { approveReady } from './actions'
import { requireSession } from '../lib/session'

export const dynamic = 'force-dynamic'

function QueueCard({ j }: { j: QueueItem }) {
  return (
    <div className="card">
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
        {j.draftFlag === 'drafted' && j.ready && <span className="chip good">draft ready</span>}
        {j.draftFlag === 'manual' && <span className="chip warn">needs your own words</span>}
        {j.needsYouCount > 0 && (
          <span className="chip warn" title="questions your profile could not answer">
            {j.needsYouCount} question{j.needsYouCount === 1 ? '' : 's'} needs you
          </span>
        )}
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
  )
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ approved?: string }>
}) {
  await requireSession()
  const { approved } = await searchParams
  const db = await getDb()
  const jobs = await queueJobs(db, new Date().toISOString())
  const bar = (await getConfig()).queueThreshold
  const outlook = jobs.length === 0 ? await queueOutlook(db) : null
  const ready = jobs.filter((j) => j.ready)
  const exceptions = jobs.filter((j) => !j.ready)
  return (
    <>
      <Nav active="queue" />
      <main>
        <div className="page-head">
          <h1>Review</h1>
          <span className="sub">{exceptions.length} need you · {ready.length} ready</span>
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
        {approved && (
          <p className="notice-ok">
            Approved {approved} draft{approved === '1' ? '' : 's'}. Run <code>pnpm jobhunter apply</code> to fill them in.
          </p>
        )}
        {ready.length > 0 && (
          <form action={approveReady} className="card">
            <h2>
              {ready.length} draft{ready.length === 1 ? '' : 's'} ready
            </h2>
            <p className="desc">
              Writing checks passed and every screening question was answered from your profile. Approving queues them
              for the apply step, where you still click submit yourself.
            </p>
            <div className="actions">
              <button className="primary">Approve all {ready.length}</button>
            </div>
          </form>
        )}
        {exceptions.length > 0 && <h2 className="section-title">Needs you</h2>}
        <div className="queue-list">
          {exceptions.map((j) => (
            <QueueCard key={j.id} j={j} />
          ))}
        </div>
        {ready.length > 0 && <h2 className="section-title">Ready</h2>}
        <div className="queue-list">
          {ready.map((j) => (
            <QueueCard key={j.id} j={j} />
          ))}
        </div>
      </main>
    </>
  )
}
