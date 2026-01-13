import { unzip, zip } from 'fflate'

/**
 * Extract all files from a DOCX (which is a ZIP archive)
 * Browser-compatible version that works with File/ArrayBuffer
 */
export async function extractDocxFromFile(
  file: File,
): Promise<Record<string, Uint8Array>> {
  const buffer = await file.arrayBuffer()
  const data = new Uint8Array(buffer)
  
  return new Promise((resolve, reject) => {
    unzip(data, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

/**
 * Extract all files from a DOCX given raw bytes
 */
export async function extractDocxFromBytes(
  data: Uint8Array,
): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
}

/**
 * Create a DOCX file from the extracted files
 * Returns Uint8Array that can be downloaded
 */
export async function createDocxBytes(
  files: Record<string, Uint8Array>,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
  })
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

/**
 * Trigger a file download in the browser
 */
export function downloadFile(data: Uint8Array, filename: string): void {
  const blob = new Blob([data], { 
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
