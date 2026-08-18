type GhField = { name?: string; type?: string }
type GhQuestion = { label?: string; fields?: GhField[] }

const IDENTITY_FIELDS = new Set([
  'first_name',
  'last_name',
  'preferred_name',
  'email',
  'phone',
  'resume',
  'cover_letter',
  'location',
])

export async function fetchGreenhouseQuestions(
  fetchJson: (url: string) => Promise<unknown>,
  slug: string,
  id: string,
): Promise<string[] | null> {
  try {
    const data = (await fetchJson(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?questions=true`,
    )) as { questions?: GhQuestion[] }
    if (!Array.isArray(data.questions)) return null
    const labels = data.questions
      .filter((q) => q.label)
      .filter((q) => !q.fields?.every((f) => f.type === 'input_file'))
      .filter((q) => !IDENTITY_FIELDS.has(q.fields?.[0]?.name ?? ''))
      .map((q) => q.label as string)
    return labels.length > 0 ? labels : null
  } catch {
    return null
  }
}
