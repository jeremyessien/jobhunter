'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb } from '../lib/db'
import { approveAllReady } from '../lib/actions'

export async function approveReady() {
  const approved = await approveAllReady(await getDb(), new Date().toISOString())
  revalidatePath('/')
  redirect(`/?approved=${approved}`)
}
