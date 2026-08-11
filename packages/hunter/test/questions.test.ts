import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchGreenhouseQuestions } from '../src/draft/questions.js'

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'greenhouse-questions.json'), 'utf8'),
)
const APPLY_URL = 'https://boards.greenhouse.io/acme/jobs/4011002'

describe('fetchGreenhouseQuestions', () => {
  it('fetches the questions endpoint derived from the apply URL and returns text questions', async () => {
    const urls: string[] = []
    const questions = await fetchGreenhouseQuestions(async (url) => {
      urls.push(url)
      return fixture
    }, APPLY_URL)
    expect(urls).toEqual(['https://boards-api.greenhouse.io/v1/boards/acme/jobs/4011002?questions=true'])
    expect(questions).toEqual([
      'Why do you want to work at Acme?',
      'Do you now or will you in the future require visa sponsorship?',
    ])
  })

  it('returns null for a non-greenhouse URL', async () => {
    expect(await fetchGreenhouseQuestions(async () => fixture, 'https://remotive.com/j/9')).toBeNull()
  })

  it('returns null when the fetch throws', async () => {
    const result = await fetchGreenhouseQuestions(async () => {
      throw new Error('404')
    }, APPLY_URL)
    expect(result).toBeNull()
  })

  it('returns null when only file-upload questions exist', async () => {
    const onlyFiles = { questions: [{ label: 'Resume/CV', fields: [{ type: 'input_file' }] }] }
    expect(await fetchGreenhouseQuestions(async () => onlyFiles, APPLY_URL)).toBeNull()
  })
})
