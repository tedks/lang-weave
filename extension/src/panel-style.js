// Panel styles live inside closed shadow roots; page selectors cannot reach the controls.
export const panelStyle = String.raw`
.fw-recall {
  position: fixed; z-index: 2147483647; box-sizing: border-box; width: min(292px, calc(100vw - 16px));
  max-height: calc(100vh - 16px); overflow: auto;
  padding: 9px; border: 1px solid #52606a; border-radius: 7px;
  color: #fff; background: #1d1f23; font: 13px/1.4 system-ui, sans-serif;
  box-shadow: 0 5px 18px #0005;
}
.fw-recall-status { margin: 5px 0; }
.fw-recall-ratings { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; }
.fw-recall-secondary { text-align: right; }
.fw-recall button {
  margin: 3px 0 0; padding: 3px 5px; border: 1px solid #9aa5af; border-radius: 3px;
  color: #fff; background: #36404a; font: inherit; cursor: pointer;
}
.fw-recall-actions { display: flex; gap: 8px; }
.fw-recall-actions button:last-child, .fw-recall-secondary button {
  background: transparent; border-color: transparent; text-decoration: underline;
}
.fw-recall button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.fw-recall button:disabled { cursor: default; opacity: .6; }
@media (forced-colors: active) {
  .fw-recall { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; }
  .fw-recall button { color: ButtonText; background: ButtonFace; border-color: ButtonText; }
  .fw-recall-actions button:last-child, .fw-recall-secondary button {
    color: CanvasText; background: Canvas; border-color: CanvasText;
  }
  .fw-recall button:disabled { color: GrayText; border-color: GrayText; opacity: 1; }
}
/* Guess first. The colours are the ui.css tokens (light by default, dark under prefers-color-scheme),
   copied because a web page cannot load ui.css; test/guess-content.test.js pins them to ui.css.
   Correctness is also stated in words and by border style, never by colour alone. */
.fw-guess {
  --fw-text: #182027; --fw-surface: #fff; --fw-border: #cbd2d5; --fw-muted: #59636b; --fw-danger: #9b221b;
  --fw-control-text: #182027; --fw-control-bg: #fff; --fw-control-border: #59636b;
  position: fixed; z-index: 2147483647; box-sizing: border-box; width: min(292px, calc(100vw - 16px));
  max-height: calc(100vh - 16px); overflow: auto;
  padding: 9px; border: 1px solid var(--fw-border); border-radius: 7px;
  color: var(--fw-text); background: var(--fw-surface); font: 13px/1.4 system-ui, sans-serif; text-align: left;
  box-shadow: 0 5px 18px #0003;
}
@media (prefers-color-scheme: dark) {
  .fw-guess {
    --fw-text: #f3f3f3; --fw-surface: #22282d; --fw-border: #52606a; --fw-muted: #bbc3c9; --fw-danger: #ffb4a8;
    --fw-control-text: #f3f3f3; --fw-control-bg: #343d45; --fw-control-border: #7a8790;
    box-shadow: 0 5px 18px #0005;
  }
}
.fw-guess-prompt { color: var(--fw-muted); }
.fw-guess-word { color: var(--fw-text); font-weight: 600; }
.fw-guess-choices { display: grid; gap: 4px; margin: 6px 0 0; }
.fw-guess button {
  display: block; box-sizing: border-box; width: 100%; margin: 0; padding: 4px 6px; text-align: left;
  border: 1px solid var(--fw-control-border); border-radius: 4px;
  color: var(--fw-control-text); background: var(--fw-control-bg); font: inherit; cursor: pointer;
}
.fw-guess-key { display: inline-block; min-width: 1.2em; margin-right: 4px; color: var(--fw-muted); }
.fw-guess button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.fw-guess button:disabled { cursor: default; }
.fw-guess button.fw-guess-right { border: 2px solid var(--fw-text); font-weight: 600; }
.fw-guess button.fw-guess-wrong { border: 2px dashed var(--fw-danger); }
.fw-guess-status { margin: 6px 0 0; }
.fw-guess-status-opening {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}
.fw-guess-actions { margin: 4px 0 0; text-align: right; }
.fw-guess .fw-guess-actions button {
  display: inline; width: auto; color: var(--fw-text); background: transparent; border-color: transparent;
  text-decoration: underline;
}
@media (forced-colors: active) {
  .fw-guess { color: CanvasText; background: Canvas; border-color: CanvasText; box-shadow: none; }
  .fw-guess-prompt, .fw-guess-key, .fw-guess-word { color: CanvasText; }
  .fw-guess button { color: ButtonText; background: ButtonFace; border-color: ButtonText; }
  .fw-guess button:disabled { color: GrayText; border-color: GrayText; }
  .fw-guess button.fw-guess-right { color: HighlightText; background: Highlight; border-color: Highlight; }
  .fw-guess button.fw-guess-wrong { color: CanvasText; border-color: CanvasText; }
  .fw-guess .fw-guess-actions button { color: CanvasText; background: Canvas; border-color: Canvas; }
}

`;
