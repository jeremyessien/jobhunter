import { describe, expect, it } from 'vitest'
import { buildFillPlan, type ApplicantFacts, type Drafts } from '../src/plan'
import type { GhQuestion } from '../src/questions'

const facts: ApplicantFacts = {
  name: 'Jeremiah Ekanem',
  email: 'j@example.com',
  phone: '+2348000000000',
  location: 'Lagos, Nigeria',
  links: ['https://linkedin.com/in/jeremiah', 'https://jeremiah.dev'],
}

const q = (
  label: string,
  name: string,
  type: string,
  over: Partial<GhQuestion> & { values?: { label: string; value: string | number }[] } = {},
): GhQuestion => ({
  label,
  required: over.required ?? true,
  section: over.section ?? 'standard',
  fields: [{ name, type, ...(over.values ? { values: over.values } : {}) }],
})

const standardSchema: GhQuestion[] = [
  q('First Name', 'first_name', 'input_text'),
  q('Last Name', 'last_name', 'input_text'),
  q('Email', 'email', 'input_text'),
  q('Phone', 'phone', 'input_text'),
  q('Resume', 'resume', 'input_file'),
]

const noDrafts: Drafts = { coverLetter: null, answers: [] }

describe('buildFillPlan standard fields', () => {
  it('fills name/email/phone from facts and attaches the resume', () => {
    const plan = buildFillPlan(standardSchema, noDrafts, facts, '/tmp/resume.pdf')
    expect(plan.fills).toEqual([
      { fieldName: 'first_name', value: 'Jeremiah', source: 'profile' },
      { fieldName: 'last_name', value: 'Ekanem', source: 'profile' },
      { fieldName: 'email', value: 'j@example.com', source: 'profile' },
      { fieldName: 'phone', value: '+2348000000000', source: 'profile' },
    ])
    expect(plan.attachments).toEqual([{ fieldName: 'resume', path: '/tmp/resume.pdf' }])
    expect(plan.needsYou).toEqual([])
  })
  it('single-word names fill both first and last', () => {
    const plan = buildFillPlan(standardSchema.slice(0, 2), noDrafts, { ...facts, name: 'Cher' }, '/r.pdf')
    expect(plan.fills.map((f) => f.value)).toEqual(['Cher', 'Cher'])
  })
  it('missing phone becomes needsYou', () => {
    const plan = buildFillPlan([q('Phone', 'phone', 'input_text')], noDrafts, { ...facts, phone: undefined }, '/r.pdf')
    expect(plan.fills).toEqual([])
    expect(plan.needsYou).toHaveLength(1)
  })
  it('fills location fields from facts', () => {
    const plan = buildFillPlan([q('Location', 'location', 'input_text', { section: 'location' })], noDrafts, facts, '/r.pdf')
    expect(plan.fills).toEqual([{ fieldName: 'location', value: 'Lagos, Nigeria', source: 'profile' }])
  })
})

describe('buildFillPlan hidden and personal fields', () => {
  it('silently skips hidden fields like latitude', () => {
    const schema = [
      q('Latitude', 'latitude', 'input_hidden', { section: 'location' }),
      q('Longitude', 'longitude', 'input_hidden', { section: 'location' }),
    ]
    const plan = buildFillPlan(schema, noDrafts, facts, '/r.pdf')
    expect(plan.fills).toEqual([])
    expect(plan.needsYou).toEqual([])
  })
  it('never auto-fills demographic or compliance questions, even with a drafted answer', () => {
    const schema = [
      q('Gender', 'gender', 'multi_value_single_select', {
        section: 'demographic',
        values: [{ label: 'Male', value: 1 }],
      }),
      q('DisabilityStatus', 'disability_status', 'multi_value_single_select', {
        section: 'compliance',
        values: [{ label: 'Yes', value: 1 }],
      }),
    ]
    const drafts: Drafts = {
      coverLetter: null,
      answers: [
        { question: 'Gender', answer: 'Male' },
        { question: 'DisabilityStatus', answer: 'Yes' },
      ],
    }
    const plan = buildFillPlan(schema, drafts, facts, '/r.pdf')
    expect(plan.fills).toEqual([])
    expect(plan.needsYou).toEqual([
      { label: 'Gender', reason: 'personal question — answer it yourself' },
      { label: 'DisabilityStatus', reason: 'personal question — answer it yourself' },
    ])
  })
})

describe('buildFillPlan links', () => {
  it('routes linkedin and website labels to the right links', () => {
    const schema = [q('LinkedIn Profile', 'question_1', 'input_text'), q('Website', 'question_2', 'input_text')]
    const plan = buildFillPlan(schema, noDrafts, facts, '/r.pdf')
    expect(plan.fills).toEqual([
      { fieldName: 'question_1', value: 'https://linkedin.com/in/jeremiah', source: 'profile' },
      { fieldName: 'question_2', value: 'https://jeremiah.dev', source: 'profile' },
    ])
  })
})

describe('buildFillPlan drafted answers', () => {
  it('joins answers by normalized label and fills verbatim', () => {
    const schema = [q('Why do you want to work here? *', 'question_3', 'textarea')]
    const drafts: Drafts = { coverLetter: null, answers: [{ question: 'Why do you want to work here?', answer: 'Because payments.' }] }
    const plan = buildFillPlan(schema, drafts, facts, '/r.pdf')
    expect(plan.fills).toEqual([{ fieldName: 'question_3', value: 'Because payments.', source: 'draft' }])
  })
  it('an unmatched question is needsYou, never guessed', () => {
    const schema = [q('Describe your Rust experience', 'question_4', 'textarea')]
    const plan = buildFillPlan(schema, noDrafts, facts, '/r.pdf')
    expect(plan.fills).toEqual([])
    expect(plan.needsYou).toEqual([{ label: 'Describe your Rust experience', reason: 'no drafted answer' }])
  })
  it('select answers must match an option label exactly and carry the option label for comboboxes', () => {
    const schema = [
      q('Are you willing to work remotely?', 'question_5', 'multi_value_single_select', {
        values: [
          { label: 'Yes', value: 1 },
          { label: 'No', value: 0 },
        ],
      }),
    ]
    const yes = buildFillPlan(
      schema,
      { coverLetter: null, answers: [{ question: 'Are you willing to work remotely?', answer: 'yes' }] },
      facts,
      '/r.pdf',
    )
    expect(yes.fills).toEqual([{ fieldName: 'question_5', value: '1', optionLabel: 'Yes', source: 'draft' }])
    const essay = buildFillPlan(
      schema,
      { coverLetter: null, answers: [{ question: 'Are you willing to work remotely?', answer: 'Absolutely, I prefer it' }] },
      facts,
      '/r.pdf',
    )
    expect(essay.fills).toEqual([])
    expect(essay.needsYou[0].reason).toContain('not one of the form')
  })
})

describe('buildFillPlan cover letter', () => {
  it('fills a cover letter textarea from the draft', () => {
    const schema = [q('Cover Letter', 'cover_letter', 'textarea', { required: false })]
    const plan = buildFillPlan(schema, { coverLetter: 'Dear team', answers: [] }, facts, '/r.pdf')
    expect(plan.fills).toEqual([{ fieldName: 'cover_letter', value: 'Dear team', source: 'draft' }])
  })
  it('upload-only cover letter is needsYou', () => {
    const schema: GhQuestion[] = [
      { label: 'Cover Letter', required: false, section: 'standard', fields: [{ name: 'cover_letter', type: 'input_file' }] },
    ]
    const plan = buildFillPlan(schema, { coverLetter: 'Dear team', answers: [] }, facts, '/r.pdf')
    expect(plan.needsYou).toEqual([{ label: 'Cover Letter', reason: 'form only accepts an uploaded file' }])
  })
})

describe('buildFillPlan drift and unknowns', () => {
  it('a reworded question loses its match and surfaces as needsYou', () => {
    const schema = [q('Tell us why you want to join', 'question_6', 'textarea')]
    const drafts: Drafts = { coverLetter: null, answers: [{ question: 'Why do you want to work here?', answer: 'x' }] }
    expect(buildFillPlan(schema, drafts, facts, '/r.pdf').needsYou).toHaveLength(1)
  })
  it('unknown field types are needsYou', () => {
    const schema = [q('Availability', 'question_7', 'date_picker')]
    const drafts: Drafts = { coverLetter: null, answers: [{ question: 'Availability', answer: 'Two weeks' }] }
    const plan = buildFillPlan(schema, drafts, facts, '/r.pdf')
    expect(plan.needsYou[0].reason).toContain('date_picker')
  })
})