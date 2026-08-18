import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { applyFillPlan, findForm, formTarget, highlightNeedsYou, looksLikeSecurityWall } from '../src/browser'

const fixtureUrl = (name: string) => pathToFileURL(resolve(__dirname, 'fixtures', name)).href

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome' })
  page = await browser.newPage()
  await page.goto(fixtureUrl('greenhouse-form.html'))
})
afterAll(async () => {
  await browser.close()
})

describe('formTarget', () => {
  it('returns the main frame when the form is at top level', async () => {
    await page.goto(fixtureUrl('greenhouse-form.html'))
    const target = await formTarget(page)
    expect(target).not.toBeNull()
    expect(target === page.mainFrame()).toBe(true)
  })
  it('finds the form inside an embedded iframe', async () => {
    await page.goto(fixtureUrl('embed-wrapper.html'))
    await page.waitForSelector('iframe')
    const target = await formTarget(page)
    expect(target).not.toBeNull()
    expect(target === page.mainFrame()).toBe(false)
    expect(await target!.locator('#first_name').count()).toBe(1)
  })
  it('returns null on a page with no application form', async () => {
    await page.setContent('<h1>Nothing here</h1>')
    expect(await formTarget(page)).toBeNull()
  })
})

describe('applyFillPlan', () => {
  it('fills text fields by id and attaches files on the captured real form', async () => {
    await page.goto(fixtureUrl('greenhouse-form.html'))
    const resumePdf = join(tmpdir(), 'resume-test.pdf')
    writeFileSync(resumePdf, '%PDF-1.4 test')
    const target = (await formTarget(page))!
    const result = await applyFillPlan(target, {
      fills: [
        { fieldName: 'first_name', value: 'Jeremiah', source: 'profile' },
        { fieldName: 'email', value: 'j@example.com', source: 'profile' },
        { fieldName: 'cover_letter', value: 'Dear team', source: 'draft' },
      ],
      attachments: [{ fieldName: 'resume', path: resumePdf }],
      needsYou: [],
    })
    expect(result.applied).toBe(3)
    expect(result.failed).toEqual([{ label: 'cover_letter', reason: 'could not fill this field' }])
    expect(await target.locator('#first_name').inputValue()).toBe('Jeremiah')
    expect(await target.locator('#email').inputValue()).toBe('j@example.com')
  })
  it('chooses combobox options by label and native select options by value', async () => {
    await page.goto(fixtureUrl('combo-form.html'))
    const target = (await formTarget(page))!
    const result = await applyFillPlan(target, {
      fills: [
        { fieldName: 'question_1', value: '1', optionLabel: 'Yes', source: 'draft' },
        { fieldName: 'question_2', value: '30', optionLabel: '30 days', source: 'draft' },
      ],
      attachments: [],
      needsYou: [],
    })
    expect(result.failed).toEqual([])
    expect(result.applied).toBe(2)
    expect(await target.locator('#question_1').inputValue()).toBe('Yes')
    expect(await target.locator('#question_2').inputValue()).toBe('30')
  })
  it('reports missing fields as failed instead of throwing', async () => {
    await page.goto(fixtureUrl('greenhouse-form.html'))
    const target = (await formTarget(page))!
    const result = await applyFillPlan(target, {
      fills: [{ fieldName: 'no_such_field_xyz', value: 'v', source: 'draft' }],
      attachments: [],
      needsYou: [],
    })
    expect(result.applied).toBe(0)
    expect(result.failed).toEqual([{ label: 'no_such_field_xyz', reason: 'field not found on the form' }])
  })
  it('never touches submit controls', async () => {
    await page.goto(fixtureUrl('combo-form.html'))
    const target = (await formTarget(page))!
    await applyFillPlan(target, {
      fills: [{ fieldName: 'question_1', value: '1', optionLabel: 'Yes', source: 'draft' }],
      attachments: [],
      needsYou: [],
    })
    expect(page.url()).toContain('combo-form.html')
  })
})

describe('looksLikeSecurityWall', () => {
  it('recognizes cloudflare-style challenge pages', () => {
    expect(looksLikeSecurityWall('Just a moment...', 'Performing security verification')).toBe(true)
    expect(looksLikeSecurityWall('Attention Required! | Cloudflare', '')).toBe(true)
    expect(looksLikeSecurityWall('Careers', 'verify you are human to continue')).toBe(true)
  })
  it('does not flag normal job pages', () => {
    expect(looksLikeSecurityWall('Job Application for Staff Product Designer at Twilio', 'Apply for this role')).toBe(false)
  })
})

describe('findForm', () => {
  it('finds an immediately-present form without clicking anything', async () => {
    await page.goto(fixtureUrl('greenhouse-form.html'))
    const found = await findForm(page, { timeoutMs: 5000, log: () => {} })
    expect(found).not.toBeNull()
    expect(found!.page === page).toBe(true)
  })
  it('clicks an Apply control to reveal a hidden form', async () => {
    await page.goto(fixtureUrl('apply-gate.html'))
    const found = await findForm(page, { timeoutMs: 8000, applyClickAfterMs: 1000, log: () => {} })
    expect(found).not.toBeNull()
    expect(await found!.frame.locator('#first_name').count()).toBe(1)
  })
  it('adopts a form that an Apply click opens in a new tab', async () => {
    const context = await browser.newContext()
    const tabPage = await context.newPage()
    await tabPage.goto(fixtureUrl('apply-newtab.html'))
    const found = await findForm(tabPage, { timeoutMs: 10000, applyClickAfterMs: 500, log: () => {} })
    expect(found).not.toBeNull()
    expect(found!.page === tabPage).toBe(false)
    expect(await found!.frame.locator('#first_name').count()).toBe(1)
    await context.close()
  })
  it('gives up quietly when no form ever appears', async () => {
    await page.setContent('<h1>Nothing here</h1>')
    const found = await findForm(page, { timeoutMs: 1500, log: () => {} })
    expect(found).toBeNull()
  })
  it('reports a security wall through the log callback', async () => {
    await page.setContent('<p>Performing security verification</p>')
    await page.evaluate(() => {
      document.title = 'Just a moment...'
    })
    const messages: string[] = []
    await findForm(page, { timeoutMs: 1500, wallGraceMs: 200, log: (m) => messages.push(m) })
    expect(messages.some((m) => m.includes('checking'))).toBe(true)
  })
})

describe('highlightNeedsYou', () => {
  it('injects the banner and outlines matched question containers', async () => {
    await page.goto(fixtureUrl('combo-form.html'))
    const target = (await formTarget(page))!
    await highlightNeedsYou(target, [
      { label: 'Are you willing to work remotely?', reason: 'no drafted answer' },
      { label: 'Some Unfindable Question', reason: 'no drafted answer' },
    ])
    expect(await target.locator('#jh-needs-you-banner').count()).toBe(1)
    expect(await target.locator('.jh-needs-you').count()).toBeGreaterThanOrEqual(1)
  })
  it('does nothing for an empty list', async () => {
    await page.goto(fixtureUrl('combo-form.html'))
    const target = (await formTarget(page))!
    await highlightNeedsYou(target, [])
    expect(await target.locator('#jh-needs-you-banner').count()).toBe(0)
  })
})