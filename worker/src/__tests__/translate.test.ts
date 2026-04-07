import { describe, it, expect } from 'vitest'
import { buildTranslateRequest, parseTranslateResponse, LANG_CODES } from '../translate'

describe('translate', () => {
  describe('LANG_CODES', () => {
    it('maps all supported languages', () => {
      expect(LANG_CODES.en).toBe('en')
      expect(LANG_CODES.el).toBe('el')
      expect(LANG_CODES.fr).toBe('fr')
      expect(LANG_CODES.de).toBe('de')
    })
  })

  describe('buildTranslateRequest', () => {
    it('builds correct request body', () => {
      const body = buildTranslateRequest('Hello world', 'en', 'el')
      expect(body).toEqual({ SourceLanguageCode: 'en', TargetLanguageCode: 'el', Text: 'Hello world' })
    })

    it('rejects same source and target', () => {
      expect(() => buildTranslateRequest('Hello', 'en', 'en')).toThrow('Source and target language must differ')
    })
  })

  describe('parseTranslateResponse', () => {
    it('extracts translated text', () => {
      expect(parseTranslateResponse({ TranslatedText: 'Γεια σου κόσμε' })).toBe('Γεια σου κόσμε')
    })
  })
})
