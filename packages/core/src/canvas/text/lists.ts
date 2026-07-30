import type { SceneNode, StyleRun } from '@open-pencil/scene-graph'

// Figma draws list markers outside the character stream; canvaskit paragraphs
// have no per-line marker or hanging-indent API, so we inject the markers into
// the text and remap style-run offsets. En space after the marker approximates
// Figma's marker gap; em spaces express nested indentation.
const MARKER_GAP = '\u2002' // en space
const INDENT = '\u2003' // em space

export interface ListTextView {
  text: string
  styleRuns: StyleRun[]
}

function lineMarker(node: SceneNode, index: number, ordinal: number): string {
  const line = node.textLines.at(index)
  if (!line || line.lineType === 'PLAIN') return ''
  const indent = INDENT.repeat(Math.max(0, line.indentationLevel - 1))
  if (line.lineType === 'ORDERED_LIST') return `${indent}${ordinal}.${MARKER_GAP}`
  return `${indent}•${MARKER_GAP}`
}

/**
 * Returns a marker-augmented view of a TEXT node's characters and style runs,
 * or null when the node has no list lines. Style-run offsets are shifted by
 * the markers inserted at the starts of preceding (or the same) lines.
 */
export function listTextView(node: SceneNode): ListTextView | null {
  // Hand-built partial nodes (tests, tooling) may omit the field entirely.
  const nodeLines = node.textLines as SceneNode['textLines'] | undefined
  if (!nodeLines?.some((line) => line.lineType !== 'PLAIN')) return null

  const lines = node.text.split('\n')
  const lineStarts: number[] = []
  const markers: string[] = []
  let start = 0
  let ordinal = 0
  for (let index = 0; index < lines.length; index++) {
    const line = node.textLines.at(index)
    ordinal = line?.lineType === 'ORDERED_LIST' ? ordinal + 1 : 0
    lineStarts.push(start)
    markers.push(lineMarker(node, index, ordinal))
    start += lines[index].length + 1
  }

  const text = lines.map((line, index) => markers[index] + line).join('\n')

  const shiftAt = (position: number): number => {
    let shift = 0
    for (let index = 0; index < lineStarts.length; index++) {
      if (lineStarts[index] > position) break
      shift += markers[index].length
    }
    return shift
  }

  const styleRuns = node.styleRuns.map((run) => {
    const newStart = run.start + shiftAt(run.start)
    const newEnd = run.start + run.length + shiftAt(run.start + run.length - 1)
    return { ...run, start: newStart, length: Math.max(0, newEnd - newStart) }
  })

  return { text, styleRuns }
}
