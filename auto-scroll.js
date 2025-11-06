// Wait for the window to load completely
window.addEventListener('load', function () {
    // Function to scroll down the page
    function scrollDown() {
        // Scroll down by the height of the window
        window.scrollBy(0, window.innerHeight);

        // Check if we have reached the bottom of the page
        if ((window.innerHeight + window.scrollY) < document.body.offsetHeight) {
            // If not at the bottom, scroll down again after a short delay
            setTimeout(scrollDown, 1000); // Adjust the delay as needed
        } else {
            console.log("Reached the bottom of the page.");
        }
    }

    // Start the scrolling function
    scrollDown();
});
