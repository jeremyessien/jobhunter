import { z } from 'zod'

const fieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  values: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })).optional(),
})

const questionSchema = z.object({
  label: z.string(),
  required: z.boolean().default(false),
  fields: z.array(fieldSchema).min(1),
})

export type GhField = z.infer<typeof fieldSchema>
export type GhSection = 'standard' | 'location' | 'demographic' | 'compliance'
export type GhQuestion = z.infer<typeof questionSchema> & { section: GhSection }

export { parseGreenhouseUrl } from '@jobhunter/core'

const parseSection = (raw: unknown, section: GhSection): GhQuestion[] => {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((q) => {
    const result = questionSchema.safeParse(q)
    return result.success ? [{ ...result.data, section }] : []
  })
}

export async function fetchGreenhouseSchema(
  fetchJson: (url: string) => Promise<unknown>,
  slug: string,
  id: string,
): Promise<GhQuestion[] | null> {
  try {
    const data = (await fetchJson(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?questions=true`,
    )) as {
      questions?: unknown
      location_questions?: unknown
      demographic_questions?: unknown
      compliance?: unknown
    }
    const demographic = data.demographic_questions as { questions?: unknown } | unknown[] | undefined
    const compliance = Array.isArray(data.compliance) ? (data.compliance as { questions?: unknown }[]) : []
    const questions = [
      ...parseSection(data.questions, 'standard'),
      ...parseSection(data.location_questions, 'location'),
      ...parseSection(Array.isArray(demographic) ? demographic : demographic?.questions, 'demographic'),
      ...compliance.flatMap((c) => parseSection(c.questions, 'compliance')),
    ]
    return questions.length > 0 ? questions : null
  } catch {
    return null
  }
}