import type { ParagraphSegment } from './types'

// Regex to find paragraph elements
const PARAGRAPH_REGEX = /<w:p\b[^>]*>(.*?)<\/w:p>/gs

// Regex to find all <w:t> elements within content
const TEXT_ELEMENT_REGEX = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g

/**
 * Extract all paragraph segments from an XML string
 * Each paragraph becomes one translation unit with all its text combined
 */
export function extractParagraphSegments(
  xml: string,
  source: string,
  startId: number = 0,
): { segments: ParagraphSegment[], nextId: number } {
  const segments: ParagraphSegment[] = []
  let id = startId
  let match: RegExpExecArray | null

  // Reset regex state
  PARAGRAPH_REGEX.lastIndex = 0

  // eslint-disable-next-line no-cond-assign
  while ((match = PARAGRAPH_REGEX.exec(xml)) !== null) {
    const paragraphContent = match[1] || ''

    // Extract all text from this paragraph
    const texts: string[] = []
    let textMatch: RegExpExecArray | null
    TEXT_ELEMENT_REGEX.lastIndex = 0

    // eslint-disable-next-line no-cond-assign
    while ((textMatch = TEXT_ELEMENT_REGEX.exec(paragraphContent)) !== null) {
      texts.push(textMatch[2] || '')
    }

    // Combine all text from the paragraph
    const combinedText = texts.join('')

    // Skip empty paragraphs
    if (combinedText.trim().length === 0) {
      continue
    }

    segments.push({
      id: `p${id}`,
      text: combinedText,
      source,
      runCount: texts.length,
    })

    id++
  }

  return { segments, nextId: id }
}

/**
 * Replace paragraph text in an XML string with translations
 * Uses a map of original paragraph text -> translated text
 */
export function replaceParagraphText(
  xml: string,
  translations: Map<string, string>,
): string {
  // Reset regex state
  PARAGRAPH_REGEX.lastIndex = 0

  return xml.replace(PARAGRAPH_REGEX, (fullMatch, paragraphContent) => {
    // Extract all text from this paragraph to get the key
    const texts: string[] = []
    let textMatch: RegExpExecArray | null
    TEXT_ELEMENT_REGEX.lastIndex = 0

    // eslint-disable-next-line no-cond-assign
    while ((textMatch = TEXT_ELEMENT_REGEX.exec(paragraphContent)) !== null) {
      texts.push(textMatch[2] || '')
    }

    const originalText = texts.join('')

    // Check if we have a translation for this paragraph
    const translation = translations.get(originalText)
    if (translation === undefined) {
      return fullMatch // No translation, keep original
    }

    // Replace the text: put all translation in first <w:t>, clear the rest
    let isFirst = true
    TEXT_ELEMENT_REGEX.lastIndex = 0

    const newParagraphContent = paragraphContent.replace(
      TEXT_ELEMENT_REGEX,
      (textMatch: string, attrs: string) => {
        if (isFirst) {
          isFirst = false
          const attributes = attrs || ''
          return `<w:t${attributes}>${escapeXml(translation)}</w:t>`
        }
        else {
          // Clear subsequent text runs (keep the element but empty)
          const attributes = attrs || ''
          return `<w:t${attributes}></w:t>`
        }
      },
    )

    return `<w:p${fullMatch.match(/<w:p(\s[^>]*)?>/)?.[1] || ''}>${newParagraphContent}</w:p>`
  })
}

/**
 * Escape special XML characters
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Unescape XML entities back to normal characters
 */
export function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
}
