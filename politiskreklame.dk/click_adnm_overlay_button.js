class ClickAdnmOverlayButton
{
  // required: an id for this behavior, will be displayed in the logs
  static id = "click_adnm_overlay_button";

  // required: decide when to run this behavior
  static isMatch() {
    return true; // run on all pages
  }

  // optional: also run in iframes
  static runInIframes = true;

  // required: main behavior
  async* run(ctx) {
    const selector = "button.adnm-overlayButton";

    try {
      // wait for the button to appear (up to 10s)
      await ctx.page.waitForSelector(selector, { timeout: 10000 });

      // click once
      await ctx.page.click(selector);

      yield ctx.getState(`clicked ${selector}`);
    } catch (e) {
      yield ctx.getState(`${selector} not found or not clickable`);
    }
  }
}
