import type { ParagraphSegment, TranslationFile } from './types'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'
import {
  extractDocx,
  getTranslatableFiles,
  getXmlContent,
} from './docx-utils'
import { extractParagraphSegments } from './xml-utils'

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 1) {
    console.error('Usage: bun run src/extract.ts <input.docx> [output.json]')
    process.exit(1)
  }

  const inputPath = args[0]!
  const outputPath
    = args[1] ?? join(dirname(inputPath), `${basename(inputPath, '.docx')}.json`)

  console.log(`📄 Extracting text from: ${inputPath}`)

  // Extract the DOCX
  const files = await extractDocx(inputPath)
  console.log(`📦 Found ${Object.keys(files).length} files in DOCX`)

  // Get all translatable files
  const translatableFiles = getTranslatableFiles(files)
  console.log(`📝 Translatable files: ${translatableFiles.join(', ')}`)

  // Extract paragraph segments from each file
  const allSegments: ParagraphSegment[] = []
  let nextId = 0

  for (const filePath of translatableFiles) {
    const xml = getXmlContent(files, filePath)
    const { segments, nextId: newNextId } = extractParagraphSegments(
      xml,
      filePath,
      nextId,
    )
    allSegments.push(...segments)
    nextId = newNextId
    console.log(`  - ${filePath}: ${segments.length} paragraphs`)
  }

  // Create the translation file
  const translationFile: TranslationFile = {
    originalFile: basename(inputPath),
    extractedAt: new Date().toISOString(),
    segments: allSegments,
  }

  // Write the JSON output
  await Bun.write(outputPath, JSON.stringify(translationFile, null, 2))
  console.log(`\n✅ Extracted ${allSegments.length} paragraphs`)
  console.log(`📁 Output saved to: ${outputPath}`)

  // Also create a simpler format for LLM translation
  const simpleOutputPath = outputPath.replace('.json', '.txt')
  const simpleFormat = allSegments
    .map(seg => `[${seg.id}]\n${seg.text}\n`)
    .join('\n')

  await Bun.write(simpleOutputPath, simpleFormat)
  console.log(`📁 Simple format saved to: ${simpleOutputPath}`)

  console.log(`
📋 Next steps:
   1. Translate the paragraphs in ${basename(outputPath)}
      - Fill in the "translation" field for each segment
      - Or ask an LLM to translate the .txt file
   
   2. Run: bun run inject ${inputPath} ${outputPath}
`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
