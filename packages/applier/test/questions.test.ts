import { describe, expect, it } from 'vitest'
import { fetchGreenhouseSchema, parseGreenhouseUrl } from '../src/questions'

const fetchWith = (response: unknown) => async () => response

const apiResponse = {
  questions: [
    {
      label: 'First Name',
      required: true,
      fields: [{ name: 'first_name', type: 'input_text' }],
    },
    {
      label: 'Are you willing to work remotely?',
      required: true,
      fields: [
        {
          name: 'question_1',
          type: 'multi_value_single_select',
          values: [
            { label: 'Yes', value: 1 },
            { label: 'No', value: 0 },
          ],
        },
      ],
    },
  ],
  location_questions: [
    { label: 'Location', required: true, fields: [{ name: 'location', type: 'input_text' }] },
    { label: 'Latitude', required: true, fields: [{ name: 'latitude', type: 'input_hidden' }] },
  ],
  demographic_questions: {
    header: 'Voluntary Self-Identification',
    questions: [
      {
        label: 'Gender',
        required: false,
        fields: [{ name: 'gender', type: 'multi_value_single_select', values: [{ label: 'Male', value: 1 }] }],
      },
    ],
  },
  compliance: [
    {
      type: 'eeoc',
      description: 'EEOC',
      questions: [
        {
          label: 'DisabilityStatus',
          required: false,
          fields: [{ name: 'disability_status', type: 'multi_value_single_select', values: [{ label: 'Yes', value: 1 }] }],
        },
      ],
    },
  ],
}

describe('parseGreenhouseUrl', () => {
  it('extracts slug and id from hosted board urls', () => {
    expect(parseGreenhouseUrl('https://boards.greenhouse.io/acme/jobs/123')).toEqual({ slug: 'acme', id: '123' })
    expect(parseGreenhouseUrl('https://job-boards.greenhouse.io/twilio/jobs/8039842')).toEqual({
      slug: 'twilio',
      id: '8039842',
    })
  })
  it('returns null for custom career domains', () => {
    expect(parseGreenhouseUrl('https://www.brex.com/careers/8399566002?gh_jid=8399566002')).toBeNull()
    expect(parseGreenhouseUrl('https://stripe.com/jobs/search?gh_jid=7998031')).toBeNull()
  })
})

describe('fetchGreenhouseSchema', () => {
  it('calls the board API with the given slug and id', async () => {
    const calls: string[] = []
    await fetchGreenhouseSchema(async (url) => {
      calls.push(url)
      return apiResponse
    }, 'acme', '123')
    expect(calls).toEqual(['https://boards-api.greenhouse.io/v1/boards/acme/jobs/123?questions=true'])
  })
  it('merges all question sections with section tags', async () => {
    const schema = await fetchGreenhouseSchema(fetchWith(apiResponse), 'acme', '123')
    expect(schema?.map((q) => [q.label, q.section])).toEqual([
      ['First Name', 'standard'],
      ['Are you willing to work remotely?', 'standard'],
      ['Location', 'location'],
      ['Latitude', 'location'],
      ['Gender', 'demographic'],
      ['DisabilityStatus', 'compliance'],
    ])
  })
  it('keeps select options and required flags intact', async () => {
    const schema = await fetchGreenhouseSchema(fetchWith(apiResponse), 'acme', '123')
    const remote = schema?.find((q) => q.label === 'Are you willing to work remotely?')
    expect(remote).toMatchObject({
      required: true,
      section: 'standard',
      fields: [
        {
          name: 'question_1',
          type: 'multi_value_single_select',
          values: [
            { label: 'Yes', value: 1 },
            { label: 'No', value: 0 },
          ],
        },
      ],
    })
  })
  it('handles demographic_questions given as a bare array', async () => {
    const schema = await fetchGreenhouseSchema(
      fetchWith({ demographic_questions: apiResponse.demographic_questions.questions }),
      'acme',
      '123',
    )
    expect(schema?.map((q) => [q.label, q.section])).toEqual([['Gender', 'demographic']])
  })
  it('returns null when the API fails', async () => {
    const schema = await fetchGreenhouseSchema(async () => {
      throw new Error('network down')
    }, 'acme', '123')
    expect(schema).toBeNull()
  })
  it('returns null when no sections have questions', async () => {
    expect(await fetchGreenhouseSchema(fetchWith({}), 'acme', '123')).toBeNull()
    expect(await fetchGreenhouseSchema(fetchWith({ questions: [], compliance: [] }), 'acme', '123')).toBeNull()
  })
  it('drops malformed questions but keeps valid ones', async () => {
    const schema = await fetchGreenhouseSchema(
      fetchWith({ questions: [{ label: 'Ok', required: false, fields: [{ name: 'f', type: 'input_text' }] }, { nope: true }] }),
      'acme',
      '123',
    )
    expect(schema).toEqual([{ label: 'Ok', required: false, section: 'standard', fields: [{ name: 'f', type: 'input_text' }] }])
  })
})