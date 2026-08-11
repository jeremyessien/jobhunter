type GhQuestion = { label?: string; fields?: { type?: string }[] }

const APPLY_URL_PATTERN = /greenhouse\.io\/([^/]+)\/jobs\/(\d+)/

export async function fetchGreenhouseQuestions(
  fetchJson: (url: string) => Promise<unknown>,
  applyUrl: string,
): Promise<string[] | null> {
  const match = APPLY_URL_PATTERN.exec(applyUrl)
  if (!match) return null
  const [, slug, id] = match
  try {
    const data = (await fetchJson(
      `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${id}?questions=true`,
    )) as { questions?: GhQuestion[] }
    if (!Array.isArray(data.questions)) return null
    const labels = data.questions
      .filter((q) => q.label && !q.fields?.some((f) => f.type === 'input_file'))
      .map((q) => q.label as string)
    return labels.length > 0 ? labels : null
  } catch {
    return null
  }
}
