// Define a function to scroll down the page
function scrollDown() {
    // Scroll down by a certain number of pixels
    window.scrollBy(0, window.innerHeight);

    // Check if we have reached the bottom of the page
    if ((window.innerHeight + window.scrollY) < document.body.offsetHeight) {
        // If not at the bottom, scroll down again after a delay
        setTimeout(scrollDown, 1000); // scroll every second
    }
}

// Start scrolling down
scrollDown();
