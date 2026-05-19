/**
 * training-exporter.test.ts — Unit tests for TrainingExporter.
 *
 * Coverage:
 *   bucketLatency    — boundaries fast/normal/slow/critical
 *   bucketTokens     — boundaries low/medium/high/extreme
 *   rowToSample      — full transformation including tool_sequence passthrough
 *   buildExportSummary — empty input + multi-row + range echo
 *   toJsonl          — one row per line, valid JSON each, no trailing newline
 */

import { describe, it, expect } from 'vitest'
import {
  bucketLatency,
  bucketTokens,
  rowToSample,
  buildExportSummary,
  toJsonl,
} from '@/lib/ai/training/TrainingExporter'
import type { SampleRow } from '@/lib/ai/training/contracts'

const BASE: SampleRow = {
  traceId:      't-1',
  createdAt:    '2026-05-20T10:00:00Z',
  channel:      'whatsapp',
  outcome:      'success',
  errorCode:    null,
  totalTokens:  150,
  latencyMs:    600,
  stepsCount:   2,
  toolsCount:   1,
  toolSequence: ['confirm_booking'],
  intent:       'book_appointment',
}

describe('bucketLatency', () => {
  it.each<[number, ReturnType<typeof bucketLatency>]>([
    [0,    'fast'],
    [799,  'fast'],
    [800,  'normal'],
    [1999, 'normal'],
    [2000, 'slow'],
    [4999, 'slow'],
    [5000, 'critical'],
    [9999, 'critical'],
  ])('%i → %s', (ms, expected) => {
    expect(bucketLatency(ms)).toBe(expected)
  })
})

describe('bucketTokens', () => {
  it.each<[number, ReturnType<typeof bucketTokens>]>([
    [0,    'low'],
    [199,  'low'],
    [200,  'medium'],
    [799,  'medium'],
    [800,  'high'],
    [1999, 'high'],
    [2000, 'extreme'],
    [9999, 'extreme'],
  ])('%i → %s', (n, expected) => {
    expect(bucketTokens(n)).toBe(expected)
  })
})

describe('rowToSample', () => {
  it('produces the snake_case JSONL shape and applies buckets', () => {
    const out = rowToSample({ ...BASE, latencyMs: 3500, totalTokens: 1200 })
    expect(out).toEqual({
      trace_id:       't-1',
      created_at:     '2026-05-20T10:00:00Z',
      channel:        'whatsapp',
      outcome:        'success',
      error_code:     null,
      tool_sequence:  ['confirm_booking'],
      latency_bucket: 'slow',
      tokens_bucket:  'high',
      steps_count:    2,
      tools_count:    1,
      intent:         'book_appointment',
    })
  })

  it('preserves failure metadata (error_code + null intent)', () => {
    const out = rowToSample({
      ...BASE,
      outcome:    'failure',
      errorCode:  'SLOT_CONFLICT',
      intent:     null,
      toolSequence: ['get_available_slots', 'confirm_booking'],
    })
    expect(out.outcome).toBe('failure')
    expect(out.error_code).toBe('SLOT_CONFLICT')
    expect(out.intent).toBeNull()
    expect(out.tool_sequence).toEqual(['get_available_slots', 'confirm_booking'])
  })
})

describe('buildExportSummary', () => {
  it('echoes range and counts samples from input rows', () => {
    const summary = buildExportSummary([BASE, { ...BASE, traceId: 't-2' }], '2026-05-19T00:00:00Z', '2026-05-20T00:00:00Z')
    expect(summary.sampleCount).toBe(2)
    expect(summary.rangeStart).toBe('2026-05-19T00:00:00Z')
    expect(summary.rangeEnd).toBe('2026-05-20T00:00:00Z')
    expect(summary.samples).toHaveLength(2)
  })

  it('handles empty input', () => {
    const summary = buildExportSummary([], 'a', 'b')
    expect(summary.sampleCount).toBe(0)
    expect(summary.samples).toEqual([])
  })
})

describe('toJsonl', () => {
  it('emits one JSON object per line with no trailing newline', () => {
    const summary = buildExportSummary([BASE, { ...BASE, traceId: 't-2' }], 'a', 'b')
    const text = toJsonl(summary.samples)
    const lines = text.split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).trace_id).toBe('t-1')
    expect(JSON.parse(lines[1]!).trace_id).toBe('t-2')
    expect(text.endsWith('\n')).toBe(false)
  })

  it('returns empty string for zero samples', () => {
    expect(toJsonl([])).toBe('')
  })
})
