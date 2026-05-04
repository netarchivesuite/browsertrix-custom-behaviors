class LogIndBehavior {
  static id = "Custom Log Ind Login Behavior";

  static isMatch() {
    return /https?:\/\/(?:www\.)?sn\.dk\/.*/.test(window.location.href);
  }

  static init() {
    return {};
  }

  static runInIframes = false;

  async awaitPageLoad() {
    return;
  }

  async *run(ctx) {
    const Lib = (ctx && ctx.Lib) ? ctx.Lib : {};

    function normalizeText(str) {
      if (!str) return "";
      return String(str).toLowerCase().replace(/\s+/g, " ").trim();
    }

    function isEnabled(elem) {
      if (!elem) return false;
      if (elem.disabled) return false;
      const ariaDisabled = elem.getAttribute("aria-disabled");
      return !(ariaDisabled && ariaDisabled.toString().toLowerCase() === "true");
    }

    function isInViewport(elem) {
      try {
        if (!elem) return false;
        if (Lib && typeof Lib.isInViewport === "function") return Lib.isInViewport(elem);

        const rect = elem.getBoundingClientRect();
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;

        return rect.width > 0 && rect.height > 0 && rect.top < vh &&
          rect.bottom > 0 && rect.left < vw && rect.right > 0;
      } catch (e) {
        return false;
      }
    }

    async function safeClick(elem, label) {
      if (!elem) {
        ctx.log({ level: "warn", msg: `safeClick: element is null for ${label}` });
        return;
      }

      if (!isEnabled(elem)) {
        ctx.log({ level: "warn", msg: `safeClick: element not enabled for ${label}` });
        return;
      }

      if (!isInViewport(elem)) {
        try {
          if (Lib && typeof Lib.scrollIntoView === "function") {
            Lib.scrollIntoView(elem);
          } else if (typeof elem.scrollIntoView === "function") {
            elem.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch (e) {
          ctx.log({ level: "warn", msg: `safeClick: scrollIntoView error for ${label}`, error: e && e.message });
        }
      }

      try {
        if (Lib && typeof Lib.scrollAndClick === "function") {
          await Lib.scrollAndClick(elem);
        } else {
          elem.click();
        }
        ctx.log({ level: "info", msg: `Clicked element: ${label}` });
      } catch (e) {
        ctx.log({ level: "error", msg: `safeClick: click error for ${label}`, error: e && e.message });
      }
    }

    async function sleep(ms) {
      if (Lib && typeof Lib.sleep === "function") return Lib.sleep(ms);
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function querySelectorAllDeep(selector) {
      const results = [];

      function collectFromRoot(root) {
        try {
          const elems = root.querySelectorAll(selector);
          for (const el of elems) results.push(el);
        } catch (e) {}

        try {
          const all = root.querySelectorAll("*");
          for (const node of all) {
            if (node && node.shadowRoot) collectFromRoot(node.shadowRoot);
          }
        } catch (e) {}
      }

      collectFromRoot(document);
      return results;
    }

    function findLinkByExactText(textToFind) {
      const targetText = normalizeText(textToFind);
      const links = querySelectorAllDeep("a.service-menu__link, a");

      for (const link of links) {
        const labelCandidates = [
          link.textContent,
          link.innerText,
          link.getAttribute("aria-label"),
          link.getAttribute("title")
        ];

        for (const candidate of labelCandidates) {
          if (normalizeText(candidate) === targetText && isEnabled(link)) {
            return link;
          }
        }
      }

      return null;
    }

    function findLoginLink() {
      return findLinkByExactText("Log ind");
    }

    function findLogoutLink() {
      return findLinkByExactText("Log ud");
    }

    async function waitForVisibleSelector(selector, timeoutMs) {
      const timeout = typeof timeoutMs === "number" ? timeoutMs : 10000;
      const start = Date.now();

      if (Lib && typeof Lib.waitUntilNode === "function") {
        try {
          const node = await Lib.waitUntilNode(selector, timeout);
          if (node && isInViewport(node) && isEnabled(node)) return node;
        } catch (e) {
          ctx.log({ level: "warn", msg: `waitUntilNode failed for selector: ${selector}`, error: e && e.message });
        }
      }

      while (Date.now() - start < timeout) {
        try {
          const candidates = querySelectorAllDeep(selector);
          for (const el of candidates) {
            const style = window.getComputedStyle(el);
            const visible = style && style.display !== "none" &&
              style.visibility !== "hidden" && isInViewport(el) && isEnabled(el);

            if (visible) return el;
          }
        } catch (e) {
          ctx.log({ level: "warn", msg: `Error during waitForVisibleSelector(${selector}) iteration`, error: e && e.message });
        }

        await sleep(250);
      }

      return null;
    }

    try {
      yield { msg: "Starting LogIndBehavior: checking for 'Log ud' link first" };

      const logoutLink = findLogoutLink();
      if (logoutLink) {
        ctx.log({
          level: "info",
          msg: "'Log ud' link found; user is already logged in, skipping behavior"
        });
        yield { msg: "'Log ud' link found; behavior skipped" };
        return;
      }

      yield { msg: "No 'Log ud' link found; locating 'Log ind' link" };

      const loginLink = findLoginLink();
      if (!loginLink) {
        ctx.log({ level: "warn", msg: "No 'Log ind' link found on page" });
        yield { msg: "No 'Log ind' link found; behavior finished" };
        return;
      }

      yield { msg: "'Log ind' link found; attempting click" };
      await safeClick(loginLink, "'Log ind' link");

      await sleep(500);

      yield { msg: "Waiting for email and password fields to appear" };
      const emailInput = await waitForVisibleSelector("#email", 15000);
      const passwordInput = await waitForVisibleSelector("#password", 15000);

      if (!emailInput || !passwordInput) {
        ctx.log({
          level: "warn",
          msg: "Email or password input not found or not visible",
          emailFound: !!emailInput,
          passwordFound: !!passwordInput
        });
        yield { msg: "Could not find visible email/password fields; behavior finished" };
        return;
      }

      try {
        emailInput.focus();
      } catch (e) {}

      try {
        emailInput.value = "[sn.dk_username]";
        emailInput.dispatchEvent(new Event("input", { bubbles: true }));
        emailInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        ctx.log({ level: "error", msg: "Error setting email value", error: e && e.message });
      }

      try {
        passwordInput.focus();
      } catch (e) {}

      try {
        passwordInput.value = "[sn.dk_password]";
        passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
        passwordInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (e) {
        ctx.log({ level: "error", msg: "Error setting password value", error: e && e.message });
      }

      yield { msg: "Filled email and password fields" };

      const submitCandidates = querySelectorAllDeep('input[type="submit"], button[type="submit"], button');
      let submitButton = null;
      const targetSubmitText = normalizeText("Log ind");

      for (const btn of submitCandidates) {
        if (!isEnabled(btn)) continue;

        const value = btn.getAttribute("value");
        const text = btn.textContent || btn.innerText;

        if (normalizeText(value) === targetSubmitText || normalizeText(text) === targetSubmitText) {
          submitButton = btn;
          break;
        }
      }

      if (!submitButton) {
        ctx.log({ level: "warn", msg: "Submit button with value/text 'Log ind' not found" });
        yield { msg: "Submit button not found; behavior finished" };
        return;
      }

      yield { msg: "Submit button found; attempting click" };
      await safeClick(submitButton, "submit 'Log ind' button");

      yield { msg: "Login form submitted; LogIndBehavior completed" };
    } catch (err) {
      ctx.log({
        level: "error",
        msg: "Unhandled error in LogIndBehavior.run",
        error: err && err.message,
        stack: err && err.stack
      });
      yield { msg: "Error in LogIndBehavior; exiting gracefully" };
      return;
    }
  }
}
