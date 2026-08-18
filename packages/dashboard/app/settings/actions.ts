'use server'

import { writeFileSync } from 'node:fs'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb, getConfig, configPath } from '../../lib/db'
import { updateScreening, updateVoice, validateConfigText } from '../../lib/settings'

export async function saveScreening(form: FormData) {
  const lanes = getConfig().lanes
  const salaryExpectationsByLane: Record<string, string> = {}
  for (const lane of lanes) {
    const value = String(form.get(`salary_${lane.id}`) ?? '').trim()
    if (value) salaryExpectationsByLane[lane.id] = value
  }
  const text = (name: string) => {
    const v = String(form.get(name) ?? '').trim()
    return v === '' ? undefined : v
  }
  await updateScreening(await getDb(), {
    noticePeriod: text('noticePeriod'),
    salaryExpectation: text('salaryExpectation'),
    workAuthorization: text('workAuthorization'),
    salaryExpectationsByLane: Object.keys(salaryExpectationsByLane).length ? salaryExpectationsByLane : undefined,
  })
  revalidatePath('/settings')
  redirect('/settings?saved=1')
}

export async function saveVoice(form: FormData) {
  const text = (name: string) => {
    const v = String(form.get(name) ?? '').trim()
    return v === '' ? undefined : v
  }
  await updateVoice(await getDb(), { voiceSample: text('voiceSample'), voiceNotes: text('voiceNotes') })
  revalidatePath('/settings')
  redirect('/settings?saved=1')
}

export async function saveConfig(form: FormData) {
  const text = String(form.get('configText') ?? '')
  const error = validateConfigText(text)
  if (error) redirect(`/settings?error=${encodeURIComponent(error)}`)
  writeFileSync(configPath, text)
  revalidatePath('/settings')
  redirect('/settings?saved=1')
}
