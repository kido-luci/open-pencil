import {
  applyStyleRefsToFields,
  guidToString,
  VARIABLE_BINDING_FIELDS_INVERSE
} from '@open-pencil/fig/node-change'
import type { GUID } from '@open-pencil/kiwi/fig/codec'

import type { OverridePatch } from '../patches'
import { getComponentRoot } from '../resolve'
import type { OverrideContext, SymbolOverride, SymbolOverrideFields } from '../types'
import { convertOverrideToProps } from './props'

interface AliasRef {
  guid?: GUID
  assetRef?: { key: string; version?: string }
}

const VARIABLE_RADIUS_FIELDS = new Set([
  'RECTANGLE_TOP_LEFT_CORNER_RADIUS',
  'RECTANGLE_TOP_RIGHT_CORNER_RADIUS',
  'RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS',
  'RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS'
])

function assetRefKey(assetRef: { key: string; version?: string }): string {
  return assetRef.version ? `${assetRef.key}@${assetRef.version}` : assetRef.key
}

function resolveAliasId(alias: AliasRef, assetRefs: Map<string, string>): string | undefined {
  if (alias.guid) return guidToString(alias.guid)
  const assetRef = alias.assetRef
  if (!assetRef?.key) return undefined
  return assetRefs.get(assetRefKey(assetRef)) ?? assetRefs.get(assetRef.key)
}

function resolveFloatVariable(
  ctx: OverrideContext,
  id: string,
  assetRefs: Map<string, string>,
  depth = 0
): number | undefined {
  if (depth > 10) return undefined
  const nc = ctx.changeMap.get(id)
  const entry = nc?.variableDataValues?.entries?.[0]
  if (!entry) return undefined
  const value = entry.variableData.value
  if (!value) return undefined
  if (typeof value.floatValue === 'number') return value.floatValue
  const alias = value.alias as AliasRef | undefined
  const aliasId = alias ? resolveAliasId(alias, assetRefs) : undefined
  return aliasId ? resolveFloatVariable(ctx, aliasId, assetRefs, depth + 1) : undefined
}

function applyVariableRadiusOverrides(
  ctx: OverrideContext,
  fields: SymbolOverrideFields,
  props: ReturnType<typeof convertOverrideToProps>
): void {
  const entries = fields.variableConsumptionMap?.entries
  if (!entries?.length) return
  const assetRefs = ctx.assetRefToGuid
  for (const entry of entries) {
    const variableField = entry.variableField
    if (!variableField || !VARIABLE_RADIUS_FIELDS.has(variableField)) continue
    const alias = entry.variableData?.value?.alias
    const id = alias ? resolveAliasId(alias, assetRefs) : undefined
    const value = id ? resolveFloatVariable(ctx, id, assetRefs) : undefined
    if (typeof value !== 'number') continue
    const field = VARIABLE_BINDING_FIELDS_INVERSE[variableField]
    if (field === 'topLeftRadius') props.topLeftRadius = value
    else if (field === 'topRightRadius') props.topRightRadius = value
    else if (field === 'bottomRightRadius') props.bottomRightRadius = value
    else if (field === 'bottomLeftRadius') props.bottomLeftRadius = value
  }
}

// Figma writes {sessionID: -1, localID: -1} for a style reference an outer
// instance DETACHED (overrideLevel marks the chain level it undoes).
const DETACHED_STYLE_ID = 4294967295

function isDetachedStyleRef(ref: unknown): boolean {
  const guid = (ref as { guid?: GUID } | undefined)?.guid
  return guid?.sessionID === DETACHED_STYLE_ID && guid.localID === DETACHED_STYLE_ID
}

/**
 * A detached fill style means "undo the fill overridden by an intermediate
 * master; show the source component's own fill again". The override carries
 * no fillPaints of its own, so revert to the ultimate source node's fills —
 * for a target that already shows its source fill this is a no-op.
 */
function applyDetachedFillReversion(
  ctx: OverrideContext,
  targetId: string,
  fields: SymbolOverrideFields,
  props: ReturnType<typeof convertOverrideToProps>
): void {
  if (props.fills) return
  if (!isDetachedStyleRef(fields.styleIdForFill)) return
  const rootId = getComponentRoot(ctx, targetId)
  if (rootId === targetId) return
  const root = ctx.graph.getNode(rootId)
  if (!root?.fills?.length) return
  props.fills = structuredClone(root.fills)
}

export function patchFromSymbolOverride(
  ctx: OverrideContext,
  targetId: string,
  ov: SymbolOverride
): OverridePatch | null {
  const patch: OverridePatch = { targetId, source: 'symbol-override' }
  if (ov.overriddenSymbolID) {
    const swapGuid = guidToString(ov.overriddenSymbolID)
    patch.swapComponentId = ctx.guidToNodeId.get(swapGuid)
  }

  const fields: SymbolOverrideFields = { ...ov }
  delete fields.guidPath
  delete fields.overriddenSymbolID
  delete fields.componentPropAssignments
  if (Object.keys(fields).length > 0) {
    applyStyleRefsToFields(ctx.changeMap, fields)
    const props = convertOverrideToProps(fields)
    applyVariableRadiusOverrides(ctx, fields, props)
    applyDetachedFillReversion(ctx, targetId, fields, props)
    if (Object.keys(props).length > 0) patch.props = props
  }

  return patch.swapComponentId || patch.props ? patch : null
}
