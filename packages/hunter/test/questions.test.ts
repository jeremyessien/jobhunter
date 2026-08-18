import { describe, expect, it } from 'vitest'
import { fetchGreenhouseQuestions } from '../src/draft/questions.js'

const apiResponse = {
  questions: [
    { label: 'First Name', required: true, fields: [{ name: 'first_name', type: 'input_text' }] },
    { label: 'Email', required: true, fields: [{ name: 'email', type: 'input_text' }] },
    { label: 'Resume', required: true, fields: [{ name: 'resume', type: 'input_file' }] },
    { label: 'Cover Letter', required: false, fields: [{ name: 'cover_letter', type: 'input_file' }] },
    { label: 'How did you hear about this job?', required: false, fields: [{ name: 'question_1', type: 'input_text' }] },
    { label: 'Why do you want to work here?', required: true, fields: [{ name: 'question_2', type: 'textarea' }] },
  ],
  location_questions: [{ label: 'Location', required: true, fields: [{ name: 'location', type: 'input_text' }] }],
  compliance: [
    {
      type: 'eeoc',
      questions: [{ label: 'Gender', required: false, fields: [{ name: 'gender', type: 'multi_value_single_select' }] }],
    },
  ],
}

describe('fetchGreenhouseQuestions', () => {
  it('calls the board API by slug and id', async () => {
    const calls: string[] = []
    await fetchGreenhouseQuestions(async (url) => {
      calls.push(url)
      return apiResponse
    }, 'acme', '123')
    expect(calls).toEqual(['https://boards-api.greenhouse.io/v1/boards/acme/jobs/123?questions=true'])
  })
  it('returns only draftable screening questions', async () => {
    const labels = await fetchGreenhouseQuestions(async () => apiResponse, 'acme', '123')
    expect(labels).toEqual(['How did you hear about this job?', 'Why do you want to work here?'])
  })
  it('returns null when nothing draftable remains', async () => {
    const identityOnly = { questions: apiResponse.questions.slice(0, 4) }
    expect(await fetchGreenhouseQuestions(async () => identityOnly, 'acme', '123')).toBeNull()
  })
  it('returns null on API failure', async () => {
    expect(
      await fetchGreenhouseQuestions(async () => {
        throw new Error('down')
      }, 'acme', '123'),
    ).toBeNull()
  })
  it('returns null when questions are missing', async () => {
    expect(await fetchGreenhouseQuestions(async () => ({}), 'acme', '123')).toBeNull()
  })
})
