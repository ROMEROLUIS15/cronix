/**
 * wa-phone.test.ts — a stored client phone and the Meta sender id must resolve to the
 * same key, or a reminder reply can't be routed back to its business.
 */

import { describe, it, expect } from 'vitest'
import { toWaSenderId, waSenderCandidates } from '../wa-phone.ts'

describe('toWaSenderId', () => {
  it('strips formatting down to digits', () => {
    expect(toWaSenderId('+58 4121234567')).toBe('584121234567')
    expect(toWaSenderId('+58 412-1234567')).toBe('584121234567')
  })
  it('drops the national trunk zero after a 2-digit country code', () => {
    expect(toWaSenderId('+58 04121234567')).toBe('584121234567')
    expect(toWaSenderId('+44 07911 123456')).toBe('447911123456')
  })
  it('never rewrites an 11-digit NANP number whose area code contains 0', () => {
    expect(toWaSenderId('+1 202 555 1234')).toBe('12025551234')
  })
  it('leaves an already-canonical Meta sender untouched', () => {
    expect(toWaSenderId('584121234567')).toBe('584121234567')
  })
  it('returns null when there are no digits', () => {
    expect(toWaSenderId(null)).toBeNull()
    expect(toWaSenderId(undefined)).toBeNull()
    expect(toWaSenderId('')).toBeNull()
    expect(toWaSenderId(' - ')).toBeNull()
  })
})

describe('waSenderCandidates', () => {
  it('adds the trunk-zero variant a stored phone may carry', () => {
    expect(waSenderCandidates('584121234567')).toEqual(['584121234567', '5804121234567'])
  })
  it('adds no variant when re-inserting a trunk zero is implausible (too long)', () => {
    expect(waSenderCandidates('5491123456789')).toEqual(['5491123456789'])
  })
  it('every candidate canonicalizes back to the sender id', () => {
    for (const sender of ['584121234567', '447911123456', '12025551234', '573001234567', '5491123456789']) {
      for (const c of waSenderCandidates(sender)) expect(toWaSenderId(c)).toBe(sender)
    }
  })
  it('returns nothing for an empty sender', () => {
    expect(waSenderCandidates('')).toEqual([])
  })
})
