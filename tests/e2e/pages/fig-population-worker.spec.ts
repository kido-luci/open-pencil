import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

test('populates a real lazy FIG page in the retained parse worker', async () => {
  const openFile = editor.page.evaluate(() =>
    window.openPencil?.openFile?.('/tests/fixtures/gold-preview.fig')
  )
  await openFile
  await editor.canvas.waitForRender()

  const targetPageId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.getPages(true).at(-1)?.id
  })
  if (!targetPageId) throw new Error('Target page not found')

  const loading = editor.page.getByTestId('canvas-loading')
  const switchPromise = editor.page.evaluate((pageId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.switchPage(pageId)
  }, targetPageId)
  await expect(loading).toBeVisible()
  await switchPromise
  await expect(loading).not.toBeVisible()

  const currentPage = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return {
      currentPageId: store.state.currentPageId,
      childCount: store.graph.getChildren(store.state.currentPageId).length
    }
  })
  expect(currentPage.currentPageId).toBe(targetPageId)
  expect(currentPage.childCount).toBeGreaterThan(0)

  editor.canvas.assertNoErrors()
})
