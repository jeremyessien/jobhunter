'use server'

import { revalidatePath } from 'next/cache'
import { getDb } from '../../lib/db'
import { tagResponded, tagRejected } from '../../lib/actions'

export async function respond(form: FormData) {
  await tagResponded(await getDb(), Number(form.get('id')), new Date().toISOString())
  revalidatePath('/tracker')
}

export async function reject(form: FormData) {
  await tagRejected(await getDb(), Number(form.get('id')))
  revalidatePath('/tracker')
}
