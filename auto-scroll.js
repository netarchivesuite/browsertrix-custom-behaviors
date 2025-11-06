class SmoothScrollBehavior {
  // Required: An ID for this behavior, will be displayed in the logs when the behavior is run.
  static id = "Smooth Scroll Behavior";

  // Required: Function that checks if a behavior should be run for a given page.
  static isMatch() {
    return window.location.href === "https://smedebol.dk/kb/dynamictest.html";
  }

  // Optional: If defined, provides a custom way to determine when a page has finished loading.
  async awaitPageLoad() {
    // Wait until the body element is present
    await window.Lib.waitUntilNode("body");
  }

  // Required: The main behavior async iterator
  async *run(msg) {
    try {
      const scrollStep = 100; // Number of pixels to scroll at a time
      const sleepTime = 100; // Time to wait between scrolls in milliseconds
      let currentScroll = 0;

      // Get the total scrollable height of the document
      let scrollHeight = document.body.scrollHeight;

      while (currentScroll < scrollHeight) {
        // Scroll to the current offset
        window.Lib.scrollToOffset(currentScroll);

        // Increase the current scroll position
        currentScroll += scrollStep;

        // Wait for a short duration to allow for smooth scrolling
        await window.Lib.sleep(sleepTime);

        // Log the current scroll position
        yield msg.getState(`Scrolled to: ${currentScroll}px`);

        // Update the scroll height in case new content loads
        const newScrollHeight = document.body.scrollHeight;
        if (newScrollHeight > scrollHeight) {
          scrollHeight = newScrollHeight; // Update to the new scroll height
        }
      }

      // Final state when the bottom is reached
      yield msg.getState("Reached the bottom of the page");
    } catch (error) {
      // Log any errors that occur during execution
      msg.log({ level: "error", msg: "An error occurred during scrolling", error: error.message });
      return;
    }
  }
}
