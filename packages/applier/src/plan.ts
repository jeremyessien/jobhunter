import type { GhQuestion } from './questions'

export type ApplicantFacts = { name: string; email: string; phone?: string; location: string; links: string[] }
export type Drafts = { coverLetter: string | null; answers: { question: string; answer: string }[] }
export type Fill = { fieldName: string; value: string; optionLabel?: string; source: 'profile' | 'draft' | 'config' }
export type Attachment = { fieldName: string; path: string }
export type NeedsYou = { label: string; reason: string }
export type FillPlan = { fills: Fill[]; attachments: Attachment[]; needsYou: NeedsYou[] }

const normalize = (s: string) => s.trim().replace(/[*:]+$/, '').trim().replace(/\s+/g, ' ').toLowerCase()

const TEXT_TYPES = new Set(['input_text', 'textarea'])
const SELECT_TYPES = new Set(['multi_value_single_select', 'multi_value_multi_select'])

export function buildFillPlan(schema: GhQuestion[], drafts: Drafts, facts: ApplicantFacts, resumePath: string): FillPlan {
  const plan: FillPlan = { fills: [], attachments: [], needsYou: [] }
  const answersByLabel = new Map(drafts.answers.map((a) => [normalize(a.question), a.answer]))
  const [firstName, ...restName] = facts.name.trim().split(/\s+/)
  const lastName = restName.join(' ') || firstName

  const need = (question: GhQuestion, reason: string) => plan.needsYou.push({ label: question.label, reason })
  const fill = (entry: Fill) => plan.fills.push(entry)

  for (const question of schema) {
    const visibleFields = question.fields.filter((f) => f.type !== 'input_hidden')
    if (visibleFields.length === 0) continue
    const field = visibleFields[0]
    const label = normalize(question.label)

    if (question.section === 'demographic' || question.section === 'compliance') {
      need(question, 'personal question — answer it yourself')
      continue
    }

    const standard: Record<string, string | undefined> = {
      first_name: firstName,
      last_name: lastName,
      email: facts.email,
      phone: facts.phone,
      location: facts.location,
      candidate_location: facts.location,
    }

    if (field.name in standard) {
      const value = standard[field.name]
      if (value) fill({ fieldName: field.name, value, source: 'profile' })
      else need(question, 'not in your profile')
      continue
    }

    if (field.name === 'resume') {
      if (field.type === 'input_file') plan.attachments.push({ fieldName: field.name, path: resumePath })
      else need(question, 'resume field is not an upload')
      continue
    }

    if (field.name === 'cover_letter') {
      const textField = question.fields.find((f) => TEXT_TYPES.has(f.type))
      if (!textField) need(question, 'form only accepts an uploaded file')
      else if (drafts.coverLetter) fill({ fieldName: textField.name, value: drafts.coverLetter, source: 'draft' })
      else need(question, 'no drafted cover letter')
      continue
    }

    if (label.includes('linkedin')) {
      const link = facts.links.find((l) => l.includes('linkedin.com'))
      if (link && TEXT_TYPES.has(field.type)) fill({ fieldName: field.name, value: link, source: 'profile' })
      else need(question, link ? `field type ${field.type} not supported` : 'no linkedin link in your profile')
      continue
    }
    if (label.includes('website') || label.includes('portfolio')) {
      const link = facts.links.find((l) => !l.includes('linkedin.com'))
      if (link && TEXT_TYPES.has(field.type)) fill({ fieldName: field.name, value: link, source: 'profile' })
      else need(question, link ? `field type ${field.type} not supported` : 'no website link in your profile')
      continue
    }

    const answer = answersByLabel.get(label)
    if (answer === undefined) {
      need(question, 'no drafted answer')
      continue
    }
    const target = visibleFields.find((f) => TEXT_TYPES.has(f.type) || SELECT_TYPES.has(f.type))
    if (!target) {
      need(question, `field type ${field.type} not supported`)
      continue
    }
    if (SELECT_TYPES.has(target.type)) {
      const option = target.values?.find((v) => v.label.toLowerCase() === answer.trim().toLowerCase())
      if (option) fill({ fieldName: target.name, value: String(option.value), optionLabel: option.label, source: 'draft' })
      else need(question, `answer "${answer}" is not one of the form's options`)
      continue
    }
    fill({ fieldName: target.name, value: answer, source: 'draft' })
  }
  return plan
}