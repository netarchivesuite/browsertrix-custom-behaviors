class SharePointDownloadBehavior {
  // required: an id for this behavior, will be displayed in the logs
  // when the behavior is run.
  static id = "SharePoint Download Behavior";

  // required: a function that checks if a behavior should be run
  // for a given page. This example uses a regex to match the URL.
  static isMatch() {
    return /.*sharepoint\.com.*\/AllItems\.aspx.*/.test(window.location.href);
  }

  static init() { return {}; }

  // optional: if true, will also check isMatch() and possibly run
  // this behavior in each iframe.
  // if false, or not defined, this behavior will be skipped for iframes.
  static runInIframes = false;

  // required: the main behavior async iterator
  async* run(ctx) {
    try {
      // Get all selection checkboxes
      const allCheckboxes = Array.from(
        document.querySelectorAll(
          'input[type="checkbox"][data-automationid="selection-checkbox"]'
        )
      );

      // Prioritize ones with aria-label="Vælg række"
      let checkboxes = allCheckboxes.filter(
        el => el.getAttribute('aria-label') === 'Vælg række'
      );
      if (checkboxes.length === 0) {
        checkboxes = allCheckboxes;
      }

      for (let i = 1; i < checkboxes.length; i++) { // skip first
        const cb = checkboxes[i];

        // Track original state so we only unselect if we selected it
        const wasChecked =
          cb.checked || cb.getAttribute('aria-checked') === 'true';

        // Select via click if not already selected
        if (!wasChecked) {
          ctx.Lib.scrollIntoView(cb);
          try {
            cb.click();
          } catch (error) {
            ctx.log({ level: "error", msg: "Error clicking checkbox: " + error.message });
            continue;
          }
        }

        // Wait 0.5 sec
        await ctx.Lib.sleep(500);

        // Click Download button
        const downloadBtn = document.querySelector(
          'button[data-automationid="downloadCommand"][data-id="download"]'
        );

        if (!downloadBtn) {
          ctx.log({ level: "warn", msg: "Download button not found, stopping." });
          break;
        }

        try {
          downloadBtn.click();
        } catch (error) {
          ctx.log({ level: "error", msg: "Error clicking download button: " + error.message });
          break;
        }

        // Wait a bit for the action to register
        await ctx.Lib.sleep(4000);

        // Unselect via click (only if we selected it in this loop)
        if (!wasChecked && (cb.checked || cb.getAttribute('aria-checked') === 'true')) {
          try {
            cb.click();
          } catch (error) {
            ctx.log({ level: "error", msg: "Error unselecting checkbox: " + error.message });
          }
        }

        yield { msg: "Processed checkbox " + (i + 1) };
      }
    } catch (error) {
      ctx.log({ level: "error", msg: "An error occurred in the behavior: " + error.message });
    }
  }
}
