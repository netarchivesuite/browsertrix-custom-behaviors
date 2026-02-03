class GoogleCookieAccept6 {
    static id = "GoogleCookieAccept2";

    static isMatch(url) {
        // Only run on Google's consent pages
        return window.location.href.includes("consent.google.com");
    }

    static init() {
        return {};
    }

    async* run(ctx) {
        const { Lib } = ctx;

        // Small wait to let the consent UI render
        await Lib.sleep(3000);

        // Function to check if "accept" is present in the specified attributes
        const isAcceptElement = (element) => {
            const acceptKeywords = ["accept"];
            const innerText = element.innerText.toLowerCase();
            const classList = element.className.toLowerCase();
            const ariaLabel = element.getAttribute("aria-label") ? element.getAttribute("aria-label").toLowerCase() : "";
            const value = element.value ? element.value.toLowerCase() : "";

            return acceptKeywords.some(keyword => 
                innerText.includes(keyword) || 
                classList.includes(keyword) || 
                ariaLabel.includes(keyword) || 
                value.includes(keyword);
            );
        };

        // Find all clickable elements
        const elements = [
            ...document.querySelectorAll('button, a, input[type="submit"]')
        ];

        // Find the first matching element
        const btn = elements.find(isAcceptElement);

        if (btn) {
            btn.click();
            ctx.log({
                msg: "Clicked accept button",
                ariaLabel: btn.getAttribute("aria-label"),
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
