class TVMidtvestVideo {
  static id = "TVMidtvestVideo";

  static isMatch() {
    return window.location.hostname === "www.tvmidtvest.dk";
  }

  static init() {
    return {};
  }

  static runInIframe = false;

  async* run(ctx) {
    const { sleep } = ctx.Lib;

    const button = document.querySelector(
      "button.tv-hero-play-button"
    );

    if (!button) {
      yield { msg: "No TV MIDTVEST video button found" };
      return;
    }

    button.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });

    await sleep(500);

    button.click();

    yield { msg: "Opened video popover" };

    let video = null;

    for (let i = 0; i < 50; i++) {
      video =
        document.querySelector("#video-popover video") ||
        document.querySelector("video");

      if (video) break;

      await sleep(200);
    }

    if (!video) {
      yield { msg: "Video element not found" };
      return;
    }

    video.muted = true;
    video.setAttribute("muted", "");
    video.playsInline = true;

    try {
      await video.play();

      yield {
        msg: "Video playback started muted"
      };
    } catch (e) {
      yield {
        msg: `Video playback failed: ${e.name}: ${e.message}`
      };
      return;
    }

    // Keep playing long enough for Browsertrix to capture stream traffic.
    await sleep(15000);

    yield {
      msg: "Video capture playback completed"
    };
  }
}
