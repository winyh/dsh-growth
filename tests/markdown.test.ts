import { describe, expect, it } from 'vitest'
import { parseCsv, parseDataset } from '../src/data.js'
import { parseNote } from '../src/markdown.js'

describe('markdown and dataset parsing', () => {
  it('extracts frontmatter, headings, tables and links', () => {
    const note = parseNote('growth.md', `---
type: growth-project
status: active
source: https://example.com/method
---

# Growth Plan

## North Star

| metric | target |
| --- | --- |
| MRR | 10000 |

See [[Metrics]] and https://example.com/data.`)
    expect(note.title).toBe('Growth Plan')
    expect(note.frontmatter.type).toBe('growth-project')
    expect(note.tables[0]?.rows[0]?.metric).toBe('MRR')
    expect(note.internalLinks).toEqual(['Metrics'])
    expect(note.externalLinks).toContain('https://example.com/method')
  })

  it('parses CSV values into typed cells', () => {
    const rows = parseCsv('user_id,event,amount\nu1,signup,10\nu2,paid,20')
    expect(rows).toEqual([
      { user_id: 'u1', event: 'signup', amount: 10 },
      { user_id: 'u2', event: 'paid', amount: 20 },
    ])
    expect(parseDataset('events.csv', 'user_id,event\nu1,active', 10).rows).toHaveLength(1)
  })
})
