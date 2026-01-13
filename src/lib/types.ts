/**
 * Represents a paragraph extracted from the DOCX
 */
export interface ParagraphSegment {
  /** Unique identifier for this paragraph */
  id: string
  /** The combined original text content of the paragraph */
  text: string
  /** The translated text (to be filled in) */
  translation?: string
  /** Path within the DOCX (e.g., "word/document.xml") */
  source: string
  /** Number of text runs in this paragraph (for reference) */
  runCount: number
}

/**
 * The translation file format
 */
export interface TranslationFile {
  /** Source language (if known) */
  sourceLanguage?: string
  /** Target language */
  targetLanguage?: string
  /** Original DOCX filename */
  originalFile: string
  /** When the extraction was performed */
  extractedAt: string
  /** All paragraph segments */
  segments: ParagraphSegment[]
}
