import { describe, it, expect } from 'vitest'
import { toolErrorCode } from '../tool-error-code.ts'

describe('toolErrorCode', () => {
  it.each(['GUARD_REJECTED', 'REVIEWER_BLOCKED', 'DB_ERROR'])('passes %s through', code => {
    expect(toolErrorCode(code, 'TOOL_FAILURE')).toBe(code)
  })

  it('uses the caller fallback when there is no error code', () => {
    expect(toolErrorCode(undefined, 'FAST_PATH_FAILURE')).toBe('FAST_PATH_FAILURE')
  })

  it('collapses unknown codes to the fallback', () => {
    expect(toolErrorCode('SOMETHING_ELSE', 'TOOL_FAILURE')).toBe('TOOL_FAILURE')
  })
})
