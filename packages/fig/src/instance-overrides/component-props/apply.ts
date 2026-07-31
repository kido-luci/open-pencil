import { guidToString } from '@open-pencil/fig/node-change'
import { copyFills, copyStyleRuns } from '@open-pencil/scene-graph/copy'

import { applyOverridePatch, type OverridePatch } from '../patches'
import { getComponentRoot } from '../resolve'
import type { ComponentPropRef, ComponentPropValue, OverrideContext } from '../types'
import { propTextCharacters } from './values'

function applyPatchAndMark(
  ctx: OverrideContext,
  childId: string,
  patch: OverridePatch,
  modified?: Set<string>
): void {
  if (applyOverridePatch(ctx, patch)) modified?.add(childId)
}

function applyVisibleProp(
  ctx: OverrideContext,
  childId: string,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  if (val.boolValue === undefined) return
  applyPatchAndMark(
    ctx,
    childId,
    { targetId: childId, source: 'component-prop', props: { visible: val.boolValue } },
    modified
  )
}

function applyTextProp(
  ctx: OverrideContext,
  childId: string,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  const child = ctx.graph.getNode(childId)
  const text = propTextCharacters(val)
  if (text === undefined || child?.type !== 'TEXT') return
  const source = child.componentId ? ctx.graph.getNode(child.componentId) : null
  const props: Parameters<typeof applyPatchAndMark>[2]['props'] = { text }
  if (source?.type === 'TEXT' && source.text === text) {
    props.width = source.width
    props.height = source.height
    props.fills = copyFills(source.fills)
    props.styleRuns = copyStyleRuns(source.styleRuns)
    props.figmaDerivedTextGlyphs = source.figmaDerivedTextGlyphs
      ? structuredClone(source.figmaDerivedTextGlyphs)
      : undefined
  }
  applyPatchAndMark(ctx, childId, { targetId: childId, source: 'component-prop', props }, modified)
}

function applySwapProp(
  ctx: OverrideContext,
  childId: string,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  const swapId =
    propTextCharacters(val) ?? (val.guidValue ? guidToString(val.guidValue) : undefined)
  const newCompId = swapId ? ctx.guidToNodeId.get(swapId) : undefined
  if (!newCompId) return
  applyPatchAndMark(
    ctx,
    childId,
    {
      targetId: childId,
      source: 'component-prop',
      swapComponentId: getComponentRoot(ctx, newCompId)
    },
    modified
  )
}

function markSlotContentSubtree(ctx: OverrideContext, nodeId: string): void {
  ctx.slotContentNodes.add(nodeId)
  const node = ctx.graph.getNode(nodeId)
  if (!node) return
  for (const childId of node.childIds) markSlotContentSubtree(ctx, childId)
}

/**
 * A slot placeholder renders the ASSIGNED local subtree instead of its own
 * component content: Figma stores the content as a mirror node (usually on
 * the internal canvas) and points the instance at it via SLOT_CONTENT_ID.
 * Overrides recorded against the replaced component subtree no longer apply
 * — resolution refuses to land inside slot clones.
 */
function applySlotContentProp(
  ctx: OverrideContext,
  childId: string,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  const guid = val.slotContentId
  if (!guid) return
  const contentId = ctx.guidToNodeId.get(guidToString(guid))
  const content = contentId ? ctx.graph.getNode(contentId) : undefined
  const target = ctx.graph.getNode(childId)
  if (!content || !target || contentId === childId) return

  ctx.graph.preserveSourceMetadataDuring(() => {
    for (const existingId of Array.from(target.childIds)) ctx.graph.deleteNode(existingId)
    for (const sourceChildId of content.childIds) {
      const clone = ctx.graph.cloneTree(sourceChildId, childId)
      if (clone) markSlotContentSubtree(ctx, clone.id)
    }
    ctx.graph.updateNode(childId, { width: content.width, height: content.height })
  })
  modified?.add(childId)
}

export function applyComponentPropRef(
  ctx: OverrideContext,
  childId: string,
  ref: ComponentPropRef,
  val: ComponentPropValue,
  modified?: Set<string>
): void {
  switch (ref.componentPropNodeField) {
    case 'VISIBLE':
      applyVisibleProp(ctx, childId, val, modified)
      break
    case 'TEXT_DATA':
      applyTextProp(ctx, childId, val, modified)
      break
    case 'OVERRIDDEN_SYMBOL_ID':
      applySwapProp(ctx, childId, val, modified)
      break
    case 'SLOT_CONTENT_ID':
      applySlotContentProp(ctx, childId, val, modified)
      break
  }
}
