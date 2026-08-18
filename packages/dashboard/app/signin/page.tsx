import { signIn } from '../../auth'

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>
}) {
  const { from, error } = await searchParams
  return (
    <main>
      <div className="card">
        <h1>Jobhunter</h1>
        <p className="desc">Sign in to review your applications.</p>
        {error && <p className="notice-err">That account is not allowed to sign in here.</p>}
        <form
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: from ?? '/' })
          }}
        >
          <div className="actions">
            <button className="primary">Continue with Google</button>
          </div>
        </form>
      </div>
    </main>
  )
}
