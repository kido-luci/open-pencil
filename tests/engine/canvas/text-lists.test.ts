import { describe, expect, test } from 'bun:test'

import { listTextView } from '@open-pencil/core/canvas'
import { SceneGraph } from '@open-pencil/scene-graph'

const EN_SPACE = '\u2002'

function textNode(
  text: string,
  textLines: Array<{ lineType: 'PLAIN' | 'ORDERED_LIST' | 'UNORDERED_LIST'; indentationLevel: number }>,
  styleRuns: Array<{ start: number; length: number; style: object }> = []
) {
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, { text })
  node.textLines = textLines
  node.styleRuns = styleRuns as typeof node.styleRuns
  return node
}

describe('listTextView', () => {
  test('returns null for plain text', () => {
    const node = textNode('a\nb', [
      { lineType: 'PLAIN', indentationLevel: 0 },
      { lineType: 'PLAIN', indentationLevel: 0 }
    ])
    expect(listTextView(node)).toBeNull()
  })

  test('prefixes unordered lines with bullet markers', () => {
    const node = textNode('one\ntwo', [
      { lineType: 'UNORDERED_LIST', indentationLevel: 1 },
      { lineType: 'UNORDERED_LIST', indentationLevel: 1 }
    ])
    expect(listTextView(node)?.text).toBe(`•${EN_SPACE}one\n•${EN_SPACE}two`)
  })

  test('numbers consecutive ordered lines and restarts after a break', () => {
    const node = textNode('a\nb\nplain\nc', [
      { lineType: 'ORDERED_LIST', indentationLevel: 1 },
      { lineType: 'ORDERED_LIST', indentationLevel: 1 },
      { lineType: 'PLAIN', indentationLevel: 0 },
      { lineType: 'ORDERED_LIST', indentationLevel: 1 }
    ])
    expect(listTextView(node)?.text).toBe(
      `1.${EN_SPACE}a\n2.${EN_SPACE}b\nplain\n1.${EN_SPACE}c`
    )
  })

  test('shifts style runs past inserted markers', () => {
    // "one\ntwo" with a run over "two" (start 4, length 3)
    const node = textNode(
      'one\ntwo',
      [
        { lineType: 'UNORDERED_LIST', indentationLevel: 1 },
        { lineType: 'UNORDERED_LIST', indentationLevel: 1 }
      ],
      [{ start: 4, length: 3, style: {} }]
    )
    const view = listTextView(node)
    expect(view?.styleRuns[0]?.start).toBe(8)
    expect(view?.styleRuns[0]?.length).toBe(3)
    expect(view?.text.slice(8, 11)).toBe('two')
  })
})
