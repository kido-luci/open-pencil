import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  applyFigPopulationDelta,
  buildFigPopulationDelta,
  installFigMutationJournal
} from '#core/kiwi/fig/population/delta'

describe('FIG population deltas', () => {
  test('captures created, updated, and deleted nodes', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const updated = graph.createNode('RECTANGLE', page.id, { name: 'Before' })
    const deleted = graph.createNode('RECTANGLE', page.id, { name: 'Deleted' })
    const journal = installFigMutationJournal(graph)
    graph.updateNode(updated.id, { name: 'After', x: 12 })
    graph.deleteNode(deleted.id)
    const created = graph.createNode('TEXT', page.id, { text: 'Created' })
    journal.stop()
    const delta = buildFigPopulationDelta(graph, journal, [page.id])
    expect(delta.created.map(([id]) => id)).toEqual([created.id])
    expect(delta.updated).toContainEqual([
      updated.id,
      expect.objectContaining({ name: 'After', x: 12 })
    ])
    expect(delta.deleted).toEqual([deleted.id])
  })

  test('applies field changes to graph state', () => {
    const source = new SceneGraph()
    const page = source.getPages()[0]
    const node = source.createNode('RECTANGLE', page.id, { name: 'Before' })
    const target = new SceneGraph()
    target.rootId = source.rootId
    target.nodes = structuredClone(source.nodes)
    const journal = installFigMutationJournal(source)
    source.updateNode(node.id, { name: 'After', visible: false })
    journal.stop()
    const delta = buildFigPopulationDelta(source, journal, [page.id])
    applyFigPopulationDelta(target, delta)
    expect(target.getNode(node.id)).toMatchObject({ name: 'After', visible: false })
  })
})
