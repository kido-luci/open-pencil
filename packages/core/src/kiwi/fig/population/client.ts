import type { SceneGraph } from '@open-pencil/scene-graph'

import { getLazyFigImportContext } from '#core/kiwi/fig/lazy-import'
import { randomHex } from '#core/random'

import { applyFigPopulationDelta, type FigPopulationDelta } from './delta'

interface PopulationResult {
  type: 'population-result'
  requestId: string
  baseRevision: number
  populated: boolean
  delta: FigPopulationDelta
}
type WorkerResult = PopulationResult | { type: 'population-error'; error: string }

const MAX_FIG_POPULATION_WORKER_NODES = 200_000
const populationWorkers = new WeakMap<SceneGraph, Worker>()

export function registerFigPopulationWorker(graph: SceneGraph, worker: Worker): void {
  if (graph.nodes.size > MAX_FIG_POPULATION_WORKER_NODES) {
    worker.terminate()
    return
  }
  populationWorkers.set(graph, worker)
}

export function canUseFigPopulationWorker(graph: SceneGraph): boolean {
  return (
    import.meta.env.DEV &&
    populationWorkers.has(graph) &&
    getLazyFigImportContext(graph) !== undefined
  )
}

export interface FigPopulationWorker {
  populate: (pageId: string) => Promise<boolean | null>
  terminate: () => void
}

export function createFigPopulationWorker(graph: SceneGraph): FigPopulationWorker | null {
  if (!canUseFigPopulationWorker(graph)) return null
  const worker = populationWorkers.get(graph)
  if (!worker) return null
  const pending = new Map<string, { resolve: (value: boolean | null) => void; revision: number }>()
  let revision = 0
  let stale = false
  let applyingDelta = false
  const invalidate = () => {
    if (applyingDelta) return
    revision++
    stale = true
  }
  const unbind = graph.onNodeEvents({
    created: invalidate,
    updated: invalidate,
    deleted: invalidate,
    reparented: invalidate,
    reordered: invalidate
  })
  const fail = () => {
    for (const request of pending.values()) request.resolve(null)
    pending.clear()
  }
  worker.onmessage = (event: MessageEvent<WorkerResult>) => {
    const result = event.data
    if (result.type === 'population-error') return fail()
    const request = pending.get(result.requestId)
    if (!request) return
    pending.delete(result.requestId)
    if (stale || revision !== request.revision || result.baseRevision !== request.revision)
      return request.resolve(null)
    applyingDelta = true
    try {
      applyFigPopulationDelta(graph, result.delta)
      const context = getLazyFigImportContext(graph)
      if (context) context.populatedRootIds = new Set(result.delta.populatedRootIds)
    } finally {
      applyingDelta = false
    }
    request.resolve(result.populated)
  }
  worker.onerror = fail
  return {
    populate(pageId) {
      if (stale) return Promise.resolve(null)
      const requestId = randomHex()
      const baseRevision = revision
      return new Promise((resolve) => {
        pending.set(requestId, { resolve, revision: baseRevision })
        worker.postMessage({ type: 'populate', requestId, baseRevision, pageId }, [])
      })
    },
    terminate() {
      unbind()
      worker.terminate()
      populationWorkers.delete(graph)
      fail()
    }
  }
}
