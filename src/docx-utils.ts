import { promisify } from 'node:util'
import { unzip, zip } from 'fflate'

const unzipAsync = promisify(
  (
    data: Uint8Array,
    cb: (err: Error | null, result: Record<string, Uint8Array>) => void,
  ) => unzip(data, cb),
)

const zipAsync = promisify(
  (
    data: Record<string, Uint8Array>,
    cb: (err: Error | null, result: Uint8Array) => void,
  ) => zip(data, cb),
)

/**
 * Extract all files from a DOCX (which is a ZIP archive)
 */
export async function extractDocx(
  docxPath: string,
): Promise<Record<string, Uint8Array>> {
  const file = Bun.file(docxPath)
  const buffer = await file.arrayBuffer()
  const data = new Uint8Array(buffer)
  return await unzipAsync(data)
}

/**
 * Create a DOCX file from the extracted files
 */
export async function createDocx(
  files: Record<string, Uint8Array>,
  outputPath: string,
): Promise<void> {
  const zipped = await zipAsync(files)
  await Bun.write(outputPath, zipped)
}

/**
 * Get text content from an XML file in the DOCX
 */
export function getXmlContent(
  files: Record<string, Uint8Array>,
  path: string,
): string {
  const file = files[path]
  if (!file) {
    throw new Error(`File not found in DOCX: ${path}`)
  }
  return new TextDecoder().decode(file)
}

/**
 * Set text content for an XML file in the DOCX
 */
export function setXmlContent(
  files: Record<string, Uint8Array>,
  path: string,
  content: string,
): void {
  files[path] = new TextEncoder().encode(content)
}

/**
 * List all XML files in the DOCX that may contain translatable text
 */
export function getTranslatableFiles(
  files: Record<string, Uint8Array>,
): string[] {
  const translatablePatterns = [
    /^word\/document\.xml$/,
    /^word\/header\d*\.xml$/,
    /^word\/footer\d*\.xml$/,
    /^word\/footnotes\.xml$/,
    /^word\/endnotes\.xml$/,
    /^word\/comments\.xml$/,
  ]

  return Object.keys(files).filter(path =>
    translatablePatterns.some(pattern => pattern.test(path)),
  )
}
