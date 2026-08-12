import Link from 'next/link'
import { getConfig } from '../../lib/db'
import { Nav } from '../nav'

export const dynamic = 'force-dynamic'

export default function HowPage() {
  const bar = getConfig().queueThreshold
  return (
    <>
      <Nav active="how" />
      <main>
        <div className="page-head">
          <h1>How it works</h1>
          <span className="sub">5 steps</span>
        </div>
        <p className="desc">
          This tool finds jobs that fit you, writes the applications, and leaves every decision to you. The loop:
        </p>
        <ol className="steps">
          <li>
            <strong>Hunt.</strong> In a terminal, run <code>pnpm jobhunter hunt</code>. It pulls fresh postings from job
            boards, keeps the ones matching your lanes (your parallel search tracks), and scores each against your
            resume profile from 0 to 10.
          </li>
          <li>
            <strong>Draft.</strong> Anything scoring {bar}/10 or better lands in <Link href="/">Review</Link> with a
            cover letter and screening answers already written. Drafts only use facts from your profile or the posting
            — they cannot invent numbers.
          </li>
          <li>
            <strong>Decide.</strong> Open a job in Review. Read the draft, edit anything, then Approve (you plan to
            apply), Skip (never see it again), or Snooze (hide it for a few days).
          </li>
          <li>
            <strong>Apply.</strong> Use the posting&apos;s apply link, paste your draft into the real form, submit —
            then come back and hit Mark submitted on the job&apos;s page.
          </li>
          <li>
            <strong>Track.</strong> Tag replies in <Link href="/tracker">Applications</Link> to learn which lane
            converts. Watch the job boards in <Link href="/health">Sources</Link>. Keep your facts current in{' '}
            <Link href="/settings">Settings</Link>.
          </li>
        </ol>
        <h2 className="section-title">Setting up for a new person</h2>
        <p className="desc">
          Run <code>pnpm jobhunter parse-resume path/to/resume.pdf</code> and the whole pipeline adapts: their resume
          becomes the only fact source for scoring and drafting. Adjust lanes and salary expectations in{' '}
          <Link href="/settings">Settings</Link>.
        </p>
      </main>
    </>
  )
}
