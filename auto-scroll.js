class SmoothScrollBehavior {
  // Required: An ID for this behavior, will be displayed in the logs when the behavior is run.
  static id = "Smooth Scroll Behavior";

  // Required: Function that checks if a behavior should be run for a given page.
  static isMatch() {
    return window.location.href === "https://smedebol.dk/kb/dynamictest.html";
  }
  
  static init() { return {}; }

  // Required: The main behavior async iterator
  async *run(ctx) {
    try {
      const scrollStep = 100; // Number of pixels to scroll at a time
      const sleepTime = 100; // Time to wait between scrolls in milliseconds
      let scrollHeight = document.body.scrollHeight; // Total scrollable height
      let currentScroll = 0;

      while (currentScroll < scrollHeight) {
        ctx.Lib.scrollToOffset(currentScroll);
        currentScroll += scrollStep;

        // Wait for a short duration to allow for smooth scrolling
        await ctx.Lib.sleep(sleepTime);

        // Update scroll height in case new content loads
        scrollHeight = document.body.scrollHeight;
        
        // Yield the current state
        yield ctx.getState(`Scrolled to ${currentScroll}px`);
      }

      // Final state when the bottom is reached
      yield ctx.getState("Reached the bottom of the page");
    } catch (error) {
      ctx.log({ level: "error", msg: "An error occurred during scrolling", error: error.message });
      return;
    }
  }
}
