import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  populateAndApplyOverrides,
  protectField,
  syncNodeProps,
  type ProtectionMap
} from '../src/instance-overrides'
import type { InstanceNodeChange } from '../src/instance-overrides/types'

describe('@open-pencil/fig instance interpretation', () => {
  test('populates an empty instance from its component tree', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const component = graph.createNode('COMPONENT', pageId, { name: 'Button' })
    graph.createNode('TEXT', component.id, { text: 'Label' })
    const instance = graph.createNode('INSTANCE', pageId, {
      componentId: component.id,
      childIds: []
    })

    populateAndApplyOverrides(graph, new Map(), new Map())

    const populated = graph.getNode(instance.id)
    expect(populated?.childIds).toHaveLength(1)
    expect(graph.getNode(populated?.childIds[0] ?? '')?.text).toBe('Label')
  })

  test('limits lazy population to required global propagation scans', () => {
    const graph = new SceneGraph()
    const activePage = graph.getPages()[0]
    const unrelatedPage = graph.addPage('Unrelated')
    const component = graph.createNode('COMPONENT', unrelatedPage.id, {
      width: 100,
      height: 40
    })
    graph.createNode('TEXT', component.id, { text: 'Label' })
    const instance = graph.createNode('INSTANCE', activePage.id, {
      width: 100,
      height: 40,
      componentId: component.id
    })
    for (let index = 0; index < 5_000; index++) {
      graph.createNode('RECTANGLE', unrelatedPage.id)
    }

    let globalScans = 0
    const getAllNodes = graph.getAllNodes.bind(graph)
    graph.getAllNodes = () => {
      globalScans++
      return getAllNodes()
    }

    populateAndApplyOverrides(graph, new Map(), new Map(), [], [activePage.id])

    expect(graph.getNode(instance.id)?.childIds).toHaveLength(1)
    expect(globalScans).toBe(2)
  })

  test('resolves text clone chains to their source values', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const source = graph.createNode('TEXT', pageId, {
      text: 'Label',
      width: 80,
      fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    const middle = graph.createNode('TEXT', pageId, {
      componentId: source.id,
      text: 'Label',
      width: 120
    })
    const leaf = graph.createNode('TEXT', pageId, {
      componentId: middle.id,
      text: 'Label',
      width: 160
    })

    populateAndApplyOverrides(graph, new Map(), new Map())

    expect(graph.getNode(middle.id)?.width).toBe(80)
    expect(graph.getNode(leaf.id)).toMatchObject({ width: 80, fills: source.fills })
  })

  test('uniformScaleFactor scales children regardless of constraints', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const component = graph.createNode('COMPONENT', pageId, { width: 200, height: 400 })
    graph.createNode('RECTANGLE', component.id, {
      name: 'photo',
      x: 20,
      y: 40,
      width: 160,
      height: 320
    })
    const instance = graph.createNode('INSTANCE', pageId, {
      componentId: component.id,
      width: 100,
      height: 200,
      childIds: []
    })
    instance.source.fig.uniformScaleFactor = 0.5

    populateAndApplyOverrides(graph, new Map(), new Map())

    const child = graph.getNode(graph.getNode(instance.id)?.childIds[0] ?? '')
    expect(child).toMatchObject({ x: 10, y: 20, width: 80, height: 160 })
  })

  test('uniformScaleFactor reaches children of nested instances', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const inner = graph.createNode('COMPONENT', pageId, { name: 'Inner', width: 200, height: 400 })
    graph.createNode('RECTANGLE', inner.id, { name: 'photo', width: 200, height: 400 })
    const outer = graph.createNode('COMPONENT', pageId, { name: 'Outer', width: 200, height: 400 })
    graph.createNode('INSTANCE', outer.id, {
      componentId: inner.id,
      width: 200,
      height: 400,
      childIds: []
    })
    const instance = graph.createNode('INSTANCE', pageId, {
      componentId: outer.id,
      width: 100,
      height: 200,
      childIds: []
    })
    instance.source.fig.uniformScaleFactor = 0.5

    populateAndApplyOverrides(graph, new Map(), new Map())

    const nested = graph.getNode(graph.getNode(instance.id)?.childIds[0] ?? '')
    expect(nested).toMatchObject({ width: 100, height: 200 })
    const grandchild = graph.getNode(nested?.childIds[0] ?? '')
    expect(grandchild).toMatchObject({ width: 100, height: 200 })
  })

  test('SLOT_CONTENT_ID assignments replace placeholder content with the local mirror', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const component = graph.createNode('COMPONENT', pageId, { name: 'Bar', width: 100, height: 20 })
    const placeholder = graph.createNode('FRAME', component.id, {
      name: 'Right Slot',
      width: 40,
      height: 20
    })
    graph.createNode('TEXT', placeholder.id, { name: 'Save', text: 'Save', opacity: 0.2 })
    const content = graph.createNode('FRAME', pageId, { name: 'Right Slot', width: 60, height: 20 })
    graph.createNode('TEXT', content.id, { name: 'Save', text: 'Save' })
    const instance = graph.createNode('INSTANCE', pageId, {
      componentId: component.id,
      width: 100,
      height: 20,
      childIds: []
    })

    const changeMap = new Map<string, InstanceNodeChange>([
      [
        '1:1',
        {
          type: 'FRAME',
          componentPropRefs: [
            { defID: { sessionID: 9, localID: 9 }, componentPropNodeField: 'SLOT_CONTENT_ID' }
          ]
        }
      ],
      [
        '1:2',
        {
          type: 'INSTANCE',
          componentPropAssignments: [
            {
              defID: { sessionID: 9, localID: 9 },
              value: {},
              varValue: { value: { slotContentIdValue: { guid: { sessionID: 1, localID: 3 } } } }
            }
          ]
        }
      ]
    ])
    const guidToNodeId = new Map([
      ['1:1', placeholder.id],
      ['1:2', instance.id],
      ['1:3', content.id]
    ])

    populateAndApplyOverrides(graph, changeMap, guidToNodeId)

    const slotClone = graph.getNode(graph.getNode(instance.id)?.childIds[0] ?? '')
    expect(slotClone?.name).toBe('Right Slot')
    expect(slotClone?.width).toBe(60)
    const text = graph.getNode(slotClone?.childIds[0] ?? '')
    expect(text?.text).toBe('Save')
    expect(text?.opacity).toBe(1)
  })

  test('preserves protected text while synchronizing other fields', () => {
    const graph = new SceneGraph()
    const pageId = graph.getPages()[0].id
    const source = graph.createNode('TEXT', pageId, { text: 'Source', visible: false })
    const target = graph.createNode('TEXT', pageId, { text: 'Override', visible: true })
    const protections: ProtectionMap = new Map()
    protectField(protections, target.id, 'text')

    syncNodeProps(graph, source, target, protections)

    expect(graph.getNode(target.id)).toMatchObject({ text: 'Override', visible: false })
  })
})
