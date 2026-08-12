'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb } from '../../../lib/db'
import { approveJob, skipJob, snoozeJob, markSubmitted, saveDraft } from '../../../lib/actions'

const jobId = (form: FormData) => Number(form.get('id'))

export async function approve(form: FormData) {
  await approveJob(await getDb(), jobId(form))
  revalidatePath('/')
  redirect('/')
}

export async function skip(form: FormData) {
  await skipJob(await getDb(), jobId(form))
  revalidatePath('/')
  redirect('/')
}

export async function snooze(form: FormData) {
  const n = Number(form.get('days'))
  const days = [1, 3, 7].includes(n) ? n : 3
  await snoozeJob(await getDb(), jobId(form), days, new Date().toISOString())
  revalidatePath('/')
  redirect('/')
}

export async function submit(form: FormData) {
  await markSubmitted(await getDb(), jobId(form), new Date().toISOString())
  revalidatePath('/')
  redirect('/tracker')
}

export async function save(form: FormData) {
  const id = jobId(form)
  const count = Number(form.get('answerCount') ?? 0)
  const answers = Array.from({ length: count }, (_, i) => ({
    question: String(form.get(`q_${i}`) ?? ''),
    answer: String(form.get(`a_${i}`) ?? ''),
  }))
  const warnings = await saveDraft(await getDb(), id, String(form.get('coverLetter') ?? ''), answers)
  revalidatePath(`/job/${id}`)
  redirect(`/job/${id}?warnings=${encodeURIComponent(JSON.stringify(warnings))}`)
}
