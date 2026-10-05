/**
 * client-phone-routing.test.ts — tier-3 tenant decision for a reply without #slug or
 * session (typically the answer to a reminder). Must route when unambiguous and never
 * guess a tenant when it isn't.
 */

import { describe, it, expect } from 'vitest'
import { pickBusinessForClientPhone, distinctBusinessIds } from '../client-phone-routing.ts'

const A = 'biz-a'
const B = 'biz-b'

describe('pickBusinessForClientPhone', () => {
  it('returns null when no client has this phone', () => {
    expect(pickBusinessForClientPhone([], [])).toBeNull()
  })

  it('routes to the only business that has this phone as a client', () => {
    expect(pickBusinessForClientPhone([{ id: 'c1', business_id: A }], [])).toBe(A)
  })

  it('treats duplicate client rows of one business as unambiguous', () => {
    const matches = [{ id: 'c1', business_id: A }, { id: 'c2', business_id: A }]
    expect(pickBusinessForClientPhone(matches, [])).toBe(A)
  })

  it('with several businesses, routes to the soonest upcoming appointment', () => {
    const matches  = [{ id: 'c1', business_id: A }, { id: 'c2', business_id: B }]
    const upcoming = [
      { business_id: A, start_at: '2026-10-09T15:00:00+00:00' },
      { business_id: B, start_at: '2026-10-06T18:00:00+00:00' },
    ]
    expect(pickBusinessForClientPhone(matches, upcoming)).toBe(B)
  })

  it('with several businesses and no upcoming appointment, refuses to guess', () => {
    const matches = [{ id: 'c1', business_id: A }, { id: 'c2', business_id: B }]
    expect(pickBusinessForClientPhone(matches, [])).toBeNull()
  })

  it('ignores upcoming appointments of businesses that did not match the phone', () => {
    const matches = [{ id: 'c1', business_id: A }, { id: 'c2', business_id: B }]
    expect(pickBusinessForClientPhone(matches, [{ business_id: 'biz-c', start_at: '2026-10-06T10:00:00Z' }])).toBeNull()
  })
})

describe('distinctBusinessIds', () => {
  it('dedupes in first-seen order', () => {
    expect(distinctBusinessIds([
      { id: 'c1', business_id: B }, { id: 'c2', business_id: A }, { id: 'c3', business_id: B },
    ])).toEqual([B, A])
  })
})
