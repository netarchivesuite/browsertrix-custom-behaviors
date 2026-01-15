class GoogleCookieAccept2
{
  static id = "GoogleCookieAccept2";

  static isMatch() {
    return window.location.href.includes("consent.google.com");
  }

  static init() {
    return {};
  }

  async awaitPageLoad(ctx) {


  }

  async* run(ctx) {
  const { Lib } = ctx;
  await Lib.sleep(3000);

   const buttons = Array.from(document.querySelectorAll('button'));
   const NumButtons = buttons.length;  
   ctx.log({msg: "Buttons found", buttons: NumButtons});
   const target = buttons.find(btn =>
    btn.innerText?.trim().toLowerCase() === 'acceptér alle'
  );

  if (target) {
    target.click();
    ctx.log({msg: "Accept button clicked"});
  } else {
    ctx.log({msg: "No Accept button Found"});
  }
  }
}
