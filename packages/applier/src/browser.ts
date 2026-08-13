import { chromium, type BrowserContext, type Frame, type Page } from 'playwright'
import type { FillPlan, NeedsYou } from './plan'

export type Session = { context: BrowserContext; close(): Promise<void> }

const FORM_MARKERS = '#first_name, #email, [id^="question_"]'

export async function launchSession(profileDir: string, headless = false): Promise<Session> {
  const context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless, viewport: null })
  return { context, close: () => context.close() }
}

export async function formTarget(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    try {
      if ((await frame.locator(FORM_MARKERS).count()) > 0) return frame
    } catch {}
  }
  return null
}

const WALL_PATTERNS = /just a moment|attention required|security verification|verify you are human|checking your browser|cloudflare/i

export function looksLikeSecurityWall(title: string, bodyText: string): boolean {
  return WALL_PATTERNS.test(title) || WALL_PATTERNS.test(bodyText)
}

export async function findForm(
  page: Page,
  opts: { timeoutMs: number; applyClickAfterMs?: number; wallGraceMs?: number; log: (message: string) => void },
): Promise<Frame | null> {
  const applyClickAfterMs = opts.applyClickAfterMs ?? 4000
  const started = Date.now()
  let deadline = started + opts.timeoutMs
  let wallReported = false
  let applyClicked = false

  while (Date.now() < deadline) {
    const target = await formTarget(page)
    if (target) return target
    try {
      const title = await page.title()
      const body = await page.evaluate(() => document.body?.innerText.slice(0, 600) ?? '')
      if (looksLikeSecurityWall(title, body)) {
        if (!wallReported) {
          wallReported = true
          deadline += opts.wallGraceMs ?? 90000
          opts.log('  the site is checking you are human — if the browser asks, complete the check; still watching')
        }
      } else if (!applyClicked && Date.now() - started > applyClickAfterMs) {
        applyClicked = true
        const cta = page.locator('a:has-text("Apply"), button:has-text("Apply"):not([type="submit"])').first()
        if ((await cta.count()) > 0) await cta.click({ timeout: 3000 }).catch(() => {})
      }
    } catch {}
    await page.waitForTimeout(500)
  }
  return null
}

const locate = (frame: Frame, name: string) => {
  const byId = frame.locator(`[id="${name}"]`)
  return { byId, fallback: frame.locator(`[name="${name}"]`) }
}

const resolveField = async (frame: Frame, name: string) => {
  const { byId, fallback } = locate(frame, name)
  if ((await byId.count()) > 0) return byId.first()
  if ((await fallback.count()) > 0) return fallback.first()
  return null
}

export async function applyFillPlan(frame: Frame, plan: FillPlan): Promise<{ applied: number; failed: NeedsYou[] }> {
  let applied = 0
  const failed: NeedsYou[] = []

  for (const fill of plan.fills) {
    const field = await resolveField(frame, fill.fieldName)
    if (!field) {
      failed.push({ label: fill.fieldName, reason: 'field not found on the form' })
      continue
    }
    try {
      const kind = await field.evaluate((el) => ({
        tag: el.tagName.toLowerCase(),
        combo: el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox',
      }))
      if (kind.tag === 'select') {
        await field.selectOption({ value: fill.value })
      } else if (kind.combo && fill.optionLabel) {
        await field.click()
        await frame.locator('[role="option"]', { hasText: fill.optionLabel }).first().click()
      } else {
        await field.fill(fill.value)
      }
      applied++
    } catch {
      failed.push({ label: fill.fieldName, reason: 'could not fill this field' })
    }
  }

  for (const attachment of plan.attachments) {
    const field = await resolveField(frame, attachment.fieldName)
    if (!field) {
      failed.push({ label: attachment.fieldName, reason: 'field not found on the form' })
      continue
    }
    try {
      await field.setInputFiles(attachment.path)
      applied++
    } catch {
      failed.push({ label: attachment.fieldName, reason: 'could not attach the file' })
    }
  }
  return { applied, failed }
}

export async function highlightNeedsYou(frame: Frame, items: NeedsYou[]): Promise<void> {
  if (items.length === 0) return
  await frame.evaluate((needs) => {
    const style = document.createElement('style')
    style.textContent =
      '.jh-needs-you { outline: 3px solid #f5a623; outline-offset: 2px; }' +
      '#jh-needs-you-banner { position: fixed; top: 8px; right: 8px; z-index: 99999; background: #1c1917; color: #ffc25e;' +
      ' padding: 10px 14px; border-radius: 8px; font: 13px/1.5 system-ui; max-width: 320px; }'
    document.head.appendChild(style)
    const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
    const unplaced: string[] = []
    for (const item of needs) {
      const label = [...document.querySelectorAll('label, legend')].find((el) =>
        normalize(el.textContent ?? '').startsWith(normalize(item.label)),
      )
      const container = label?.closest('div, fieldset') ?? label
      if (container) container.classList.add('jh-needs-you')
      else unplaced.push(item.label)
    }
    const banner = document.createElement('div')
    banner.id = 'jh-needs-you-banner'
    banner.textContent =
      needs.length + ' field(s) need you' + (unplaced.length ? ': ' + unplaced.join(', ') : ' (outlined in amber)')
    document.body.appendChild(banner)
  }, items)
}