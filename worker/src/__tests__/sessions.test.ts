import { describe, it, expect } from 'vitest'
import { createSession, listSessions, getSession, appendParagraph, deleteSession } from '../sessions'

describe('sessions (contract)', () => {
  it('exports createSession', () => { expect(typeof createSession).toBe('function') })
  it('exports listSessions', () => { expect(typeof listSessions).toBe('function') })
  it('exports getSession', () => { expect(typeof getSession).toBe('function') })
  it('exports appendParagraph', () => { expect(typeof appendParagraph).toBe('function') })
  it('exports deleteSession', () => { expect(typeof deleteSession).toBe('function') })
})
