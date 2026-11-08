async function openSettings(page) {
  const button = page.locator('.toolbar .settings-button');
  if (await button.isVisible()) await button.click();
  else {
    await page.locator('.toolbar-more-trigger').click();
    await page
      .locator('.action-menu[data-owner="toolbar"]')
      .getByRole('menuitem', { name: /^(设置|Settings)$/, exact: true })
      .click();
  }
}

module.exports = { openSettings };
