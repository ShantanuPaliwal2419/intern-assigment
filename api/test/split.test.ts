import { describe, expect, it } from 'vitest'
import { splitCents } from '../src/split'

describe('splitCents algorithm', () => {
  it('splits evenly when total is cleanly divisible', () => {
    const members = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
    const shares = splitCents(3000, members)

    expect(shares).toEqual([
      { memberId: 'm1', amountCents: 1000 },
      { memberId: 'm2', amountCents: 1000 },
      { memberId: 'm3', amountCents: 1000 },
    ])
  })

  it('allocates remainder cents to the earliest members in array order', () => {
    const members = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
    const shares = splitCents(1000, members)

    expect(shares).toEqual([
      { memberId: 'm1', amountCents: 334 },
      { memberId: 'm2', amountCents: 333 },
      { memberId: 'm3', amountCents: 333 },
    ])
  })

  it('distributes multiple remainder cents correctly', () => {
    const members = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }]
    const shares = splitCents(1001, members)

    expect(shares).toEqual([
      { memberId: 'm1', amountCents: 334 },
      { memberId: 'm2', amountCents: 334 },
      { memberId: 'm3', amountCents: 333 },
    ])
  })

  it('handles a home with a single member', () => {
    const members = [{ id: 'solo' }]
    const shares = splitCents(4999, members)

    expect(shares).toEqual([{ memberId: 'solo', amountCents: 4999 }])
  })

  it('handles amounts smaller than the member count', () => {
    const members = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }, { id: 'm4' }, { id: 'm5' }]
    const shares = splitCents(2, members)

    expect(shares).toEqual([
      { memberId: 'm1', amountCents: 1 },
      { memberId: 'm2', amountCents: 1 },
      { memberId: 'm3', amountCents: 0 },
      { memberId: 'm4', amountCents: 0 },
      { memberId: 'm5', amountCents: 0 },
    ])
    const sum = shares.reduce((acc, s) => acc + s.amountCents, 0)
    expect(sum).toBe(2)
  })

  it('throws an error if member list is empty', () => {
    expect(() => splitCents(1000, [])).toThrow('Cannot split bill among 0 members')
  })

  // Property-based test: across 100 pseudo-random configurations, sum must strictly equal total
  it('guarantees sum(shares) === totalCents and max - min <= 1 across 100 combinations', () => {
    const testCases = [
      { total: 1, count: 7 },
      { total: 100001, count: 7 },
      { total: 999999, count: 13 },
      { total: 50, count: 6 },
    ]

    for (let i = 1; i <= 100; i++) {
      const total = i * 37 + 13
      const count = (i % 15) + 1
      testCases.push({ total, count })
    }

    for (const { total, count } of testCases) {
      const members = Array.from({ length: count }, (_, i) => ({ id: `m_${i}` }))
      const shares = splitCents(total, members)

      const sum = shares.reduce((acc, s) => acc + s.amountCents, 0)
      expect(sum).toBe(total)

      const amounts = shares.map((s) => s.amountCents)
      const max = Math.max(...amounts)
      const min = Math.min(...amounts)
      expect(max - min).toBeLessThanOrEqual(1)
    }
  })
})
