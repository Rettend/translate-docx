import type { TranslationFile } from './types'
import { basename, dirname, extname, join } from 'node:path'
import process from 'node:process'
import {
  createDocx,
  extractDocx,
  getTranslatableFiles,
  getXmlContent,
  setXmlContent,
} from './docx-utils'
import { replaceParagraphText } from './xml-utils'

/**
 * Parse a .txt file in the [pN]\ntext\n format
 * Returns a map of paragraph ID to translated text
 */
function parseTxtTranslations(content: string): Map<string, string> {
  const translations = new Map<string, string>()
  const lines = content.split('\n')

  let currentId: string | null = null
  let currentText: string[] = []

  for (const line of lines) {
    const idMatch = line.match(/^\[(p\d+)\]$/)
    if (idMatch) {
      // Save previous paragraph if exists
      if (currentId !== null && currentText.length > 0) {
        translations.set(currentId, currentText.join('\n').trim())
      }
      currentId = idMatch[1]!
      currentText = []
    }
    else if (currentId !== null) {
      currentText.push(line)
    }
  }

  // Save last paragraph
  if (currentId !== null && currentText.length > 0) {
    translations.set(currentId, currentText.join('\n').trim())
  }

  return translations
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.error(
      'Usage: bun run src/inject.ts <original.docx> <translations.json|.txt> [output.docx]',
    )
    process.exit(1)
  }

  const inputDocxPath = args[0]!
  const translationsPath = args[1]!
  const outputPath
    = args[2]
      ?? join(
        dirname(inputDocxPath),
        `${basename(inputDocxPath, '.docx')}_translated.docx`,
      )

  console.log(`📄 Original DOCX: ${inputDocxPath}`)
  console.log(`📝 Translations: ${translationsPath}`)

  // Load the original extraction to get the original text -> ID mapping
  const originalJsonPath = join(
    dirname(inputDocxPath),
    `${basename(inputDocxPath, '.docx')}.json`,
  )
  const originalFile = Bun.file(originalJsonPath)

  if (!(await originalFile.exists())) {
    console.error(`❌ Original extraction not found: ${originalJsonPath}`)
    console.error(`   Run 'bun run extract ${inputDocxPath}' first.`)
    process.exit(1)
  }

  const original: TranslationFile = await originalFile.json()

  // Build ID -> original text mapping
  const idToOriginal = new Map<string, string>()
  for (const segment of original.segments) {
    idToOriginal.set(segment.id, segment.text)
  }

  // Load translations based on file type
  let idToTranslation: Map<string, string>
  const ext = extname(translationsPath).toLowerCase()

  if (ext === '.txt') {
    // Parse TXT format
    const txtContent = await Bun.file(translationsPath).text()
    idToTranslation = parseTxtTranslations(txtContent)
    console.log(`📖 Parsed ${idToTranslation.size} paragraphs from TXT`)
  }
  else {
    // Parse JSON format
    const translations: TranslationFile = await Bun.file(translationsPath).json()
    idToTranslation = new Map()
    for (const segment of translations.segments) {
      if (segment.translation) {
        idToTranslation.set(segment.id, segment.translation)
      }
    }
    console.log(`📖 Loaded ${idToTranslation.size} translations from JSON`)
  }

  // Build original text -> translated text mapping
  const textMap = new Map<string, string>()
  let translatedCount = 0
  let missingCount = 0

  for (const [id, originalText] of idToOriginal) {
    const translation = idToTranslation.get(id)
    if (translation && translation.trim().length > 0) {
      textMap.set(originalText, translation)
      translatedCount++
    }
    else {
      missingCount++
    }
  }

  console.log(
    `📊 Found ${translatedCount} translations (${missingCount} paragraphs without translation)`,
  )

  // Extract the DOCX
  const files = await extractDocx(inputDocxPath)

  // Get all translatable files
  const translatableFiles = getTranslatableFiles(files)

  // Replace text in each file
  for (const filePath of translatableFiles) {
    const xml = getXmlContent(files, filePath)
    const newXml = replaceParagraphText(xml, textMap)
    setXmlContent(files, filePath, newXml)
    console.log(`  - Updated: ${filePath}`)
  }

  // Create the output DOCX
  await createDocx(files, outputPath)

  console.log(`\n✅ Translation complete!`)
  console.log(`📁 Output saved to: ${outputPath}`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
