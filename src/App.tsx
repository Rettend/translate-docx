import type { Component } from 'solid-js'
import type { ParagraphSegment } from './lib/types'
import { createMemo, createSignal, For, Show } from 'solid-js'
import {
  createDocxBytes,
  downloadFile,
  extractDocxFromFile,
  getTranslatableFiles,
  getXmlContent,
  setXmlContent,
} from './lib/docx-utils'
import { extractParagraphSegments, replaceParagraphText } from './lib/xml-utils'

type AppState = 'upload' | 'extracted' | 'ready-to-inject'

const LANGUAGES = [
  { code: 'hu', name: 'Hungarian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
]

function getSavedLanguage() {
  try {
    return localStorage.getItem('translate-docx-lang') || 'hu'
  }
  catch {
    return 'hu'
  }
}

function saveLanguage(lang: string) {
  try {
    localStorage.setItem('translate-docx-lang', lang)
  }
  catch {
    // ignore
  }
}

const App: Component = () => {
  const [state, setState] = createSignal<AppState>('upload')
  const [file, setFile] = createSignal<File | null>(null)
  const [docxFiles, setDocxFiles] = createSignal<Record<string, Uint8Array> | null>(null)
  const [segments, setSegments] = createSignal<ParagraphSegment[]>([])
  const [isDragging, setIsDragging] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [translatedText, setTranslatedText] = createSignal('')
  const [error, setError] = createSignal<string | null>(null)
  const [targetLang, setTargetLang] = createSignal(getSavedLanguage())

  // Page/range selection (0-indexed, end is exclusive)
  const [startParagraph, setStartParagraph] = createSignal(0)
  const [endParagraph, setEndParagraph] = createSignal(0)

  const handleLanguageChange = (lang: string) => {
    setTargetLang(lang)
    saveLanguage(lang)
  }

  const getLanguageName = () => {
    return LANGUAGES.find(l => l.code === targetLang())?.name || 'Hungarian'
  }

  const getPrompt = () => {
    return `Translate the following text to ${getLanguageName()}. Keep the [pN] markers exactly as they are, only reply with the translated text, and keep all formating the same.`
  }

  // Filtered segments based on range
  const filteredSegments = createMemo(() => {
    const all = segments()
    return all.slice(startParagraph(), endParagraph())
  })

  // Format segments as [pN]\ntext\n for LLM
  const formattedText = createMemo(() => {
    return filteredSegments()
      .map(seg => `[${seg.id}]\n${seg.text}\n`)
      .join('\n')
  })

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer?.files[0]
    if (droppedFile?.name.endsWith('.docx')) {
      processFile(droppedFile)
    }
  }

  const handleFileInput = (e: Event) => {
    const input = e.target as HTMLInputElement
    const selectedFile = input.files?.[0]
    if (selectedFile) {
      processFile(selectedFile)
    }
  }

  const processFile = async (uploadedFile: File) => {
    setError(null)
    setFile(uploadedFile)

    try {
      // Extract DOCX
      const files = await extractDocxFromFile(uploadedFile)
      setDocxFiles(files)

      // Get translatable files
      const translatableFiles = getTranslatableFiles(files)

      // Extract all segments
      const allSegments: ParagraphSegment[] = []
      let nextId = 0

      for (const filePath of translatableFiles) {
        const xml = getXmlContent(files, filePath)
        const result = extractParagraphSegments(xml, filePath, nextId)
        allSegments.push(...result.segments)
        nextId = result.nextId
      }

      setSegments(allSegments)
      // Default to all paragraphs (0-indexed)
      setStartParagraph(0)
      setEndParagraph(allSegments.length)
      setState('extracted')
    }
    catch (err) {
      setError(`Failed to process file: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const copyToClipboard = async () => {
    try {
      const textToCopy = `${getPrompt()}\n\n${formattedText()}`
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
    catch {
      setError('Failed to copy to clipboard')
    }
  }

  const parseTxtTranslations = (content: string): Map<string, string> => {
    const translations = new Map<string, string>()
    const lines = content.split('\n')

    let currentId: string | null = null
    let currentText: string[] = []

    for (const line of lines) {
      const idMatch = line.match(/^\[(p\d+)\]$/)
      if (idMatch) {
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

    if (currentId !== null && currentText.length > 0) {
      translations.set(currentId, currentText.join('\n').trim())
    }

    return translations
  }

  const injectTranslations = async () => {
    const files = docxFiles()
    const originalSegments = segments()
    const translated = translatedText()

    if (!files || !translated.trim()) {
      setError('Please paste the translated text first')
      return
    }

    try {
      // Parse the translated text
      const idToTranslation = parseTxtTranslations(translated)

      // Build original text -> translated text mapping
      const textMap = new Map<string, string>()
      for (const segment of originalSegments) {
        const translation = idToTranslation.get(segment.id)
        if (translation && translation.trim().length > 0) {
          textMap.set(segment.text, translation)
        }
      }

      if (textMap.size === 0) {
        setError('No translations found. Make sure the format is [pN]\\ntext\\n')
        return
      }

      // Get translatable files and replace text
      const translatableFiles = getTranslatableFiles(files)
      for (const filePath of translatableFiles) {
        const xml = getXmlContent(files, filePath)
        const newXml = replaceParagraphText(xml, textMap)
        setXmlContent(files, filePath, newXml)
      }

      // Create and download the new DOCX
      const newDocx = await createDocxBytes(files)
      const originalName = file()?.name || 'document.docx'
      const newName = originalName.replace('.docx', '_translated.docx')
      downloadFile(newDocx, newName)

      // Reset state
      setState('ready-to-inject')
    }
    catch (err) {
      setError(`Failed to inject translations: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  const reset = () => {
    setState('upload')
    setFile(null)
    setDocxFiles(null)
    setSegments([])
    setTranslatedText('')
    setError(null)
    setCopied(false)
    setStartParagraph(0)
    setEndParagraph(0)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024)
      return `${bytes} B`
    if (bytes < 1024 * 1024)
      return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Quick select buttons
  const selectAll = () => {
    setStartParagraph(0)
    setEndParagraph(segments().length)
  }

  const selectFirst = (n: number) => {
    setStartParagraph(0)
    setEndParagraph(Math.min(n, segments().length))
  }

  return (
    <div class="min-h-screen">
      {/* Header */}
      <header class="border-b border-gray-200 bg-white">
        <nav class="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xl">📄</span>
            <span class="text-lg font-semibold text-gray-900">Translate DOCX</span>
          </div>
          <Show when={state() !== 'upload'}>
            <button
              onClick={reset}
              class="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              Start over
            </button>
          </Show>
        </nav>
      </header>

      {/* Main */}
      <main class="max-w-4xl mx-auto px-6 py-12">
        {/* Error message */}
        <Show when={error()}>
          <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error()}
          </div>
        </Show>

        {/* Upload state */}
        <Show when={state() === 'upload'}>
          <div class="text-center mb-8">
            <h1 class="text-2xl font-semibold text-gray-900 mb-2">
              Translate your document
            </h1>
            <p class="text-gray-500">
              Upload a DOCX file to extract text for translation
            </p>
          </div>

          {/* Language selector */}
          <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-2">Translate to</label>
            <select
              value={targetLang()}
              onChange={e => handleLanguageChange(e.currentTarget.value)}
              class="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
            >
              <For each={LANGUAGES}>
                {lang => (
                  <option value={lang.code}>{lang.name}</option>
                )}
              </For>
            </select>
          </div>

          <div
            class={`drop-zone relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer ${
              isDragging() ? 'dragging border-gray-900' : 'border-gray-300'
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept=".docx"
              onChange={handleFileInput}
              class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div class="w-12 h-12 mx-auto bg-gray-100 rounded-lg flex items-center justify-center text-2xl mb-4">
              📤
            </div>
            <p class="text-gray-900 mb-1">
              Drop your file here or
              {' '}
              <span class="text-blue-600">browse</span>
            </p>
            <p class="text-sm text-gray-500">
              Supports .docx files
            </p>
          </div>
        </Show>

        {/* Extracted state - show text and allow copying */}
        <Show when={state() === 'extracted'}>
          <div class="space-y-6">
            {/* File info */}
            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div class="flex items-center gap-3">
                <span class="text-2xl">📄</span>
                <div>
                  <p class="font-medium text-gray-900">{file()?.name}</p>
                  <p class="text-sm text-gray-500">
                    {formatFileSize(file()?.size || 0)}
                    {' '}
                    •
                    {segments().length}
                    {' '}
                    paragraphs total
                  </p>
                </div>
              </div>
            </div>

            {/* Paragraph range selector */}
            <div class="bg-white border border-gray-200 rounded-xl p-6">
              <h2 class="font-semibold text-gray-900 mb-4">
                Select paragraphs to translate
              </h2>

              <div class="flex flex-wrap items-center gap-4 mb-4">
                <div class="flex items-center gap-2">
                  <label class="text-sm text-gray-600">From</label>
                  <input
                    type="number"
                    min={0}
                    max={segments().length - 1}
                    value={startParagraph()}
                    onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => {
                      const val = Number.parseInt(e.currentTarget.value) || 0
                      setStartParagraph(Math.max(0, Math.min(val, segments().length - 1)))
                      if (val >= endParagraph())
                        setEndParagraph(val + 1)
                    }}
                    class="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <label class="text-sm text-gray-600">to</label>
                  <input
                    type="number"
                    min={1}
                    max={segments().length}
                    value={endParagraph()}
                    onInput={(e: InputEvent & { currentTarget: HTMLInputElement }) => {
                      const val = Number.parseInt(e.currentTarget.value) || 1
                      setEndParagraph(Math.max(startParagraph() + 1, Math.min(val, segments().length)))
                    }}
                    class="w-20 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                <span class="text-sm text-gray-500">
                  (
                  {filteredSegments().length}
                  {' '}
                  paragraphs selected)
                </span>
              </div>

              {/* Quick select buttons */}
              <div class="flex flex-wrap gap-2">
                <button
                  onClick={selectAll}
                  class="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  All
                </button>
                <button
                  onClick={() => selectFirst(10)}
                  class="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  First 10
                </button>
                <button
                  onClick={() => selectFirst(25)}
                  class="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  First 25
                </button>
                <button
                  onClick={() => selectFirst(50)}
                  class="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  First 50
                </button>
              </div>
            </div>

            {/* Step 1: Copy text */}
            <div class="bg-white border border-gray-200 rounded-xl p-6">
              <div class="flex items-center justify-between mb-4">
                <h2 class="font-semibold text-gray-900">
                  Step 1: Copy the text below
                </h2>
                <button
                  onClick={copyToClipboard}
                  class={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    copied()
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
                  }`}
                >
                  {copied() ? '✓ Copied!' : 'Copy to clipboard'}
                </button>
              </div>
              <div class="bg-gray-50 rounded-lg p-4 max-h-64 overflow-auto font-mono text-sm text-gray-700 whitespace-pre-wrap">
                {formattedText()}
              </div>
            </div>

            {/* Step 2: Translate with LLM */}
            <div class="bg-white border border-gray-200 rounded-xl p-6">
              <h2 class="font-semibold text-gray-900 mb-2">
                Step 2: Paste in your LLM
              </h2>
              <p class="text-sm text-gray-500">
                The clipboard contains the prompt and text. Just paste it into your LLM.
              </p>
            </div>

            {/* Step 3: Paste translation */}
            <div class="bg-white border border-gray-200 rounded-xl p-6">
              <h2 class="font-semibold text-gray-900 mb-4">
                Step 3: Paste the translated text
              </h2>
              <textarea
                value={translatedText()}
                onInput={e => setTranslatedText(e.currentTarget.value)}
                placeholder="Paste the translated text here..."
                class="w-full h-64 p-4 bg-gray-50 rounded-lg border border-gray-200 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>

            {/* Download button */}
            <button
              onClick={injectTranslations}
              disabled={!translatedText().trim()}
              class={`w-full py-3 rounded-lg font-medium transition-colors ${
                translatedText().trim()
                  ? 'bg-gray-900 text-white hover:bg-gray-800'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Download translated document
            </button>
          </div>
        </Show>

        {/* Ready to inject / Success state */}
        <Show when={state() === 'ready-to-inject'}>
          <div class="text-center py-12">
            <div class="w-16 h-16 mx-auto mb-6 bg-green-50 rounded-full flex items-center justify-center text-3xl">
              ✓
            </div>
            <h2 class="text-xl font-semibold text-gray-900 mb-2">
              Document downloaded!
            </h2>
            <p class="text-gray-500 mb-6">
              Your translated document has been saved.
            </p>
            <button
              onClick={reset}
              class="px-6 py-2.5 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
            >
              Translate another document
            </button>
          </div>
        </Show>
      </main>
    </div>
  )
}

export default App
