import { describe, it, expect } from 'vitest'
import { SelectorParser } from '../../src/core/selector.js'
import { InvalidSelectorError } from '../../src/utils/errors.js'

describe('SelectorParser', () => {
  describe('parse', () => {
    it('should parse simple indexed selector', () => {
      const selector = SelectorParser.parse('slide:3')
      expect(selector.type).toBe('slide')
      expect(selector.index).toBe(3)
      expect(selector.raw).toBe('slide:3')
    })

    it('should parse path-based selector', () => {
      const selector = SelectorParser.parse('slide:3/title')
      expect(selector.type).toBe('slide')
      expect(selector.index).toBe(3)
      expect(selector.path).toEqual(['title'])
      expect(selector.raw).toBe('slide:3/title')
    })

    it('should parse filtered selector with key=value', () => {
      const selector = SelectorParser.parse('shape[type=textbox]')
      expect(selector.type).toBe('shape')
      expect(selector.filters).toEqual({ type: 'textbox' })
    })

    it('should parse filtered selector with function', () => {
      const selector = SelectorParser.parse("text[contains('Revenue')]")
      expect(selector.type).toBe('text')
      expect(selector.filters).toEqual({ contains: 'Revenue' })
    })

    it('should parse type-only selector', () => {
      const selector = SelectorParser.parse('slide')
      expect(selector.type).toBe('slide')
      expect(selector.index).toBeUndefined()
      expect(selector.filters).toBeUndefined()
    })

    it('should throw on invalid selector format', () => {
      expect(() => SelectorParser.parse('invalid')).toThrow(
        InvalidSelectorError
      )
    })

    it('should handle quoted filter values', () => {
      const selector = SelectorParser.parse('shape[type="textbox"]')
      expect(selector.filters).toEqual({ type: 'textbox' })
    })
  })
})
