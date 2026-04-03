export function extractParagraphTextsFromBody(textBody: any): string[] {
  if (!textBody) return []

  // @deckflow/presentation format: textBody.children -> paragraph.children -> run.t
  if (textBody.children) {
    const paragraphs = Array.isArray(textBody.children)
      ? textBody.children
      : [textBody.children]

    const results: string[] = []
    for (const paragraph of paragraphs) {
      if (!paragraph) continue
      const runs = paragraph.children
        ? Array.isArray(paragraph.children)
          ? paragraph.children
          : [paragraph.children]
        : []

      const texts: string[] = []
      for (const run of runs) {
        if (run && typeof run.t === 'string') {
          texts.push(run.t)
        }
      }
      results.push(texts.join(''))
    }
    return results
  }

  // Fallback: standard PPTX-ish format: textBody.p -> paragraph.r -> run.t
  if (textBody.p) {
    const paragraphs = Array.isArray(textBody.p) ? textBody.p : [textBody.p]
    const results: string[] = []

    for (const paragraph of paragraphs) {
      if (!paragraph) continue
      const runs = paragraph.r
        ? Array.isArray(paragraph.r)
          ? paragraph.r
          : [paragraph.r]
        : []

      const texts: string[] = []
      for (const run of runs) {
        if (run && typeof run.t === 'string') {
          texts.push(run.t)
        }
      }
      results.push(texts.join(''))
    }

    return results
  }

  return []
}

export function findIdPathInSpTree(
  spTree: unknown,
  target: unknown,
  prefix: number[] = []
): number[] | null {
  if (!Array.isArray(spTree)) return null

  for (const node of spTree) {
    if (!node || typeof node !== 'object') continue

    const nodeIdRaw = (node as any).id
    const nodeId = typeof nodeIdRaw === 'number' ? nodeIdRaw : undefined
    const nextPrefix = nodeId !== undefined ? [...prefix, nodeId] : [...prefix]

    if (node === target) {
      return nextPrefix.length > 0 ? nextPrefix : null
    }

    const nested = (node as any).spTree
    const nestedPath = findIdPathInSpTree(nested, target, nextPrefix)
    if (nestedPath) return nestedPath
  }

  return null
}

export function formatCanonicalIdPathSelector(
  slideIndex: number,
  idPath: number[]
): string {
  return `slide:${slideIndex}/#${idPath.join(',')}`
}

export function formatParagraphSelector(
  baseSelector: string,
  paragraphIndex: number
): string {
  return `${baseSelector}/p:${paragraphIndex}`
}

export function pickQuoteForContains(value: string): '"' | "'" | null {
  const hasSingle = value.includes("'")
  const hasDouble = value.includes('"')
  if (hasSingle && hasDouble) return null
  return hasDouble ? "'" : '"'
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = 0
  while (true) {
    const next = haystack.indexOf(needle, idx)
    if (next === -1) return count
    count++
    idx = next + needle.length
  }
}
