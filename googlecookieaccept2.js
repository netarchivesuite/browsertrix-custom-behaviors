class GoogleCookieAccept2 {
  static id = "GoogleCookieAccept2";

  static isMatch(url) {
    return window.location.href.includes("consent.google.com");
  }

  static init() {
    return {};
  }

  // no async generator
  async run(ctx) {
    const Lib = ctx.Lib;

    await Lib.sleep(3000);

    function isAcceptElement(element) {
      var acceptKeywords = ["accept"];
      var innerText = ((element.innerText || "") + "").toLowerCase();
      var classList = ((element.className || "") + "").toLowerCase();
      var ariaLabel = "";
      if (element.getAttribute) {
        ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
      }
      var value = ((element.value || "") + "").toLowerCase();

      for (var i = 0; i < acceptKeywords.length; i++) {
        var keyword = acceptKeywords[i];
        if (
          innerText.indexOf(keyword) !== -1 ||
          classList.indexOf(keyword) !== -1 ||
          ariaLabel.indexOf(keyword) !== -1 ||
          value.indexOf(keyword) !== -1
        ) {
          return true;
        }
      }
      return false;
    }

    var nodeList = document.querySelectorAll('button, a, input[type="submit"]');
    var btn = null;

    for (var j = 0; j < nodeList.length; j++) {
      if (isAcceptElement(nodeList[j])) {
        btn = nodeList[j];
        break;
      }
    }

    if (btn) {
      btn.click();
      ctx.log({
        msg: "Clicked accept button",
        ariaLabel: btn.getAttribute ? btn.getAttribute("aria-label") : null,
        innerText: btn.innerText,
        textContent: btn.textContent,
        className: btn.className,
        value: btn.value
      });
    } else {
      ctx.log({ msg: "No matching accept button found" });
    }
  }
}
