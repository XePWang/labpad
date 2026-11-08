async function openSettings(page) {
  // Resolve the currently mounted control again if a zoom/resize replaces it.
  await page.locator('.toolbar .settings-button, .toolbar-more-trigger').filter({ visible: true }).click();
  const dialog = page.locator('.settings-dialog');
  const item = page.locator('.action-menu[data-owner="toolbar"]').getByRole('menuitem', { name: /^(设置|Settings)$/, exact: true });
  await dialog.or(item).first().waitFor({ state: 'visible' });
  if (await item.isVisible()) await item.click();
  await dialog.waitFor({ state: 'visible' });
}
module.exports = { openSettings };
