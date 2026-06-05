export const styles = `
  :host {
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 200px;
    min-height: 200px;
    overflow: hidden;
    --wayfinder-browser-ui-offset: 0px;
    --wayfinder-control-icon-color: #000000;
    --wayfinder-control-icon-active-color: #ffffff;
    --wayfinder-control-button-bg: #ffffff;
    --wayfinder-control-button-bg-active: #000000;
  }

  @supports (height: 100dvh) {
    :host {
      --wayfinder-browser-ui-offset: max(0px, 100vh - 100dvh);
    }
  }

  :host([hidden]) {
    display: none;
  }

  .wayfinder-container {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }

  .wayfinder-canvas {
    flex: 1;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
  }

  .wayfinder-control-rail {
    position: absolute;
    top: 16px;
    right: 16px;
    bottom: calc(
      0px + env(safe-area-inset-bottom) +
      max(
        var(--wayfinder-viewport-inset-bottom, 0px),
        var(--wayfinder-browser-ui-offset, 0px)
      )
    );
    display: flex;
    gap: 8px;
    align-items: flex-start;
    z-index: 2;
    pointer-events: auto;
  }

  .wayfinder-level-selector {
    display: none;
    flex-direction: column;
    gap: 8px;
    max-height: 100%;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 4px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .wayfinder-level-selector[data-enabled='true'] {
    display: flex;
  }

  .wayfinder-level-selector::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }

  .wayfinder-level-button {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    border-radius: 12px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: var(--wayfinder-control-button-bg);
    color: #0f172a;
    font: 600 13px/1.1 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer;
    box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.5);
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }

  .wayfinder-locate-controls {
    display: none;
    flex-direction: column;
    gap: 8px;
    padding: 4px;
  }

  .wayfinder-locate-controls[data-mode='focus'],
  .wayfinder-locate-controls[data-mode='navigation'],
  .wayfinder-locate-controls[data-has-here='true'] {
    display: flex;
  }

  .wayfinder-locate-controls [data-action='locate-here'] {
    display: none;
  }

  .wayfinder-locate-controls[data-has-here='true'] [data-action='locate-here'] {
    display: grid;
  }

  .wayfinder-locate-controls[data-mode='browse'] [data-action='locate-start'],
  .wayfinder-locate-controls[data-mode='browse'] [data-action='locate-focus'] {
    display: none;
  }

  .wayfinder-locate-controls[data-mode='focus'] [data-action='locate-start'] {
    display: none;
  }

  .wayfinder-locate-button {
    width: 44px;
    height: 44px;
    min-width: 44px;
    min-height: 44px;
    border-radius: 12px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: var(--wayfinder-control-button-bg);
    color: #0f172a;
    cursor: pointer;
    box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.5);
    display: grid;
    place-items: center;
    transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
  }

  .wayfinder-locate-button[data-active='true'] {
    background: var(--wayfinder-control-button-bg-active);
    border-color: var(--wayfinder-control-button-bg-active);
    color: var(--wayfinder-control-icon-active-color);
  }

  .wayfinder-locate-button img {
    width: 22px;
    height: 22px;
    display: block;
    filter: none;
  }

  .wayfinder-locate-button[data-active='true'] img {
    filter: none;
  }

  .wayfinder-locate-button--connector {
    display: none;
  }

  .wayfinder-locate-controls[data-mode='navigation'] .wayfinder-locate-button--connector {
    display: grid;
  }

  .wayfinder-locate-button:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
  }

  .wayfinder-qr-modal {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.52);
    z-index: 5;
    padding: 16px;
    pointer-events: auto;
    opacity: 0;
    transition: opacity 180ms ease;
  }

  .wayfinder-qr-modal[data-open='true'] {
    display: flex;
    opacity: 1;
  }

  .wayfinder-qr-dialog {
    position: relative;
    width: min(360px, calc(100vw - 32px));
    border-radius: 20px;
    border: 1px solid rgba(15, 23, 42, 0.16);
    background: rgba(255, 255, 255, 0.98);
    box-shadow: 0 24px 56px -36px rgba(15, 23, 42, 0.85);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    text-align: center;
    color: #0f172a;
  }

  .wayfinder-qr-title {
    margin: 0;
    font-size: 19px;
    line-height: 1.25;
    font-weight: 700;
  }

  .wayfinder-qr-hint {
    margin: 0;
    font-size: 13px;
    line-height: 1.4;
    color: rgba(15, 23, 42, 0.72);
  }

  .wayfinder-qr-code {
    align-self: center;
    width: min(280px, calc(100vw - 96px));
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.12);
    background: #ffffff;
    padding: 10px;
    box-sizing: border-box;
  }

  .wayfinder-qr-code svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .wayfinder-qr-copy {
    width: 100%;
    min-height: 42px;
    border-radius: 12px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: rgba(15, 23, 42, 0.04);
    color: #0f172a;
    font: 600 14px/1.2 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }

  .wayfinder-qr-copy:hover {
    background: rgba(15, 23, 42, 0.08);
  }

  .wayfinder-qr-copy:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
  }

  .wayfinder-level-button[data-active='true'] {
    background: var(--wayfinder-control-button-bg-active);
    color: var(--wayfinder-control-icon-active-color);
    border-color: var(--wayfinder-control-button-bg-active);
  }

  .wayfinder-level-button:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
  }

  .wayfinder-search {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: none;
    pointer-events: none;
    --wayfinder-search-top-offset: 16px;
    --wayfinder-search-stack-gap: 12px;
    --wayfinder-search-header-height: 42px;
    --wayfinder-search-panel-width: min(360px, 80vw);
    --wayfinder-search-info-top: calc(
      var(--wayfinder-search-top-offset) + var(--wayfinder-search-header-height) + var(--wayfinder-search-stack-gap)
    );
    font: 500 14px/1.3 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #0f172a;
  }

  .wayfinder-search[data-enabled='true'] {
    display: block;
  }

  .wayfinder-search-toggle {
    position: absolute;
    top: 16px;
    left: 16px;
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: var(--wayfinder-control-button-bg);
    box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.5);
    display: none;
    place-items: center;
    cursor: pointer;
    pointer-events: auto;
  }

  .wayfinder-search-toggle img {
    width: 20px;
    height: 20px;
    display: block;
    filter: none;
  }

  .wayfinder-search-share {
    position: absolute;
    top: var(--wayfinder-search-top-offset);
    left: calc(16px + var(--wayfinder-search-panel-width) + 8px);
    width: 44px;
    height: 44px;
    border-radius: 12px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: var(--wayfinder-control-button-bg);
    box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.5);
    display: none;
    place-items: center;
    cursor: pointer;
    pointer-events: auto;
  }

  .wayfinder-search-share img {
    width: 20px;
    height: 20px;
    display: block;
    filter: none;
  }

  .wayfinder-search[data-enabled='true'][data-mode='focus'] .wayfinder-search-share,
  .wayfinder-search[data-enabled='true'][data-mode='navigation'] .wayfinder-search-share {
    display: grid;
  }

  .wayfinder-search-share:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
  }

  .wayfinder-search-panel {
    position: absolute;
    top: var(--wayfinder-search-top-offset);
    left: 16px;
    width: var(--wayfinder-search-panel-width);
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: auto;
  }

  .wayfinder-search-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .wayfinder-search-back {
    display: none;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: rgba(255, 255, 255, 0.95);
    cursor: pointer;
    font: inherit;
    color: inherit;
  }

  .wayfinder-search-field,
  .wayfinder-search-selected {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    box-sizing: border-box;
    padding: 10px 14px;
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: rgba(255, 255, 255, 0.95);
    box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.4);
  }

  .wayfinder-search-selected {
    display: none;
    font-weight: 600;
  }

  .wayfinder-search-selected span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .wayfinder-search-selected .wayfinder-search-selected-close {
    width: 22px;
    height: 22px;
    min-width: 22px;
    margin-left: auto;
    flex-shrink: 0;
    border: none;
    box-shadow: none;
    background: transparent;
    padding: 0;
  }

  .wayfinder-search-selected .wayfinder-search-selected-close img {
    width: 12px;
    height: 12px;
  }

  .wayfinder-search-selected-close:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
  }

  /* Removed: data-selected rules that hide search field - search field now stays visible */
  /* .wayfinder-search[data-selected='true'] .wayfinder-search-field {
    display: none;
  }

  .wayfinder-search[data-selected='true'] .wayfinder-search-selected {
    display: flex;
  } */

  .wayfinder-search-field img,
  .wayfinder-search-selected img {
    width: 18px;
    height: 18px;
    display: block;
    filter: none;
  }

  .wayfinder-search-field input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    color: inherit;
  }

  .wayfinder-search-field-clear {
    width: 20px;
    height: 20px;
    min-width: 20px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 4px;
  }

  .wayfinder-search-field-clear img {
    width: 14px;
    height: 14px;
    display: block;
    filter: none;
    opacity: 0.4;
    transition: opacity 0.2s;
  }

  .wayfinder-search-field-clear:hover img {
    filter: none;
    opacity: 0.7;
  }

  .wayfinder-search-field-clear:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* Hide native search cancel button in WebKit */
  .wayfinder-search-field input::-webkit-search-cancel-button {
    display: none;
  }

  .wayfinder-search-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-radius: 16px;
    border: 1px solid rgba(15, 23, 42, 0.15);
    background: rgba(255, 255, 255, 0.95);
    max-height: 50vh;
    overflow-y: auto;
    box-shadow: 0 12px 28px -22px rgba(15, 23, 42, 0.5);
    position: relative;
    z-index: 10;
  }

  .wayfinder-search-results[hidden] {
    display: none;
  }

  .wayfinder-search-result {
    padding: 8px 10px;
    border-radius: 12px;
    border: 1px solid transparent;
    background: transparent;
    text-align: left;
    cursor: pointer;
    font-size: 14px;
    line-height: 1.2;
    font-weight: 400;
    color: inherit;
  }

  .wayfinder-search-result:hover {
    background: rgba(15, 23, 42, 0.06);
  }

  .wayfinder-search-result:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
  }

  .wayfinder-search-info {
    position: absolute;
    top: var(--wayfinder-search-info-top);
    left: 16px;
    width: var(--wayfinder-search-panel-width);
    display: flex;
    flex-direction: column;
    padding: 0;
    border-radius: 18px;
    border: 1px solid rgba(15, 23, 42, 0.15);
    background: rgba(255, 255, 255, 0.98);
    box-shadow: 0 18px 36px -28px rgba(15, 23, 42, 0.5);
    pointer-events: none;
    overflow: hidden;
    max-height: calc(100% - var(--wayfinder-search-info-top) - 16px);
    opacity: 0;
    visibility: hidden;
    transform: translateY(6px) scale(0.995);
    transition: opacity 200ms ease, transform 220ms ease, visibility 0s linear 220ms;
  }

  .wayfinder-search-info[data-visible='true'] {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateY(0) scale(1);
    transition-delay: 0s, 0s, 0s;
  }

  .wayfinder-search-info-header-actions {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 2;
  }

  .wayfinder-search-info-header-actions .wayfinder-search-info-close {
    display: none;
  }

  .wayfinder-search-info-action {
    width: 33px;
    height: 33px;
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: var(--wayfinder-control-button-bg);
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.5);
    transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
  }

  .wayfinder-search-info-action img {
    width: 16px;
    height: 16px;
    display: block;
    filter: none;
  }

  .wayfinder-search-info-expand {
    display: none;
  }

  .wayfinder-search-info-media {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: rgba(148, 163, 184, 0.2);
    overflow: hidden;
    flex-shrink: 0;
    position: relative;
  }

  .wayfinder-search-info-media-track {
    width: 100%;
    height: 100%;
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scroll-behavior: smooth;
    scrollbar-width: none;
  }

  .wayfinder-search-info-media-track::-webkit-scrollbar {
    display: none;
  }

  .wayfinder-search-info-media-track img {
    flex: 0 0 100%;
    width: 100%;
    height: 100%;
    object-fit: cover;
    scroll-snap-align: start;
    display: block;
  }

  .wayfinder-search-info-pager {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    display: none;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(6px);
  }

  .wayfinder-search-info-pager-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    border: none;
    padding: 0;
    background: rgba(255, 255, 255, 0.55);
    cursor: pointer;
  }

  .wayfinder-search-info-pager-dot[data-active='true'] {
    background: rgba(255, 255, 255, 0.95);
    transform: scale(1.1);
  }

  .wayfinder-search-info-pager-dot:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.9);
    outline-offset: 2px;
  }

  .wayfinder-search-info-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    overflow: hidden;
    min-height: 0;
    flex: 1 1 auto;
  }

  .wayfinder-search-info-meta {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .wayfinder-search-info-logo {
    width: 56px;
    height: 56px;
    border-radius: 0;
    background: transparent;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }

  .wayfinder-search-info-logo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .wayfinder-search-info-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .wayfinder-search-info-title {
    font-size: 18px;
    line-height: 1.2;
    font-weight: 700;
  }

  .wayfinder-search-info-venue {
    font-size: 13px;
    line-height: 1.2;
    font-weight: 500;
    color: rgba(15, 23, 42, 0.7);
  }

  .wayfinder-search-info-description {
    display: none;
    font-size: 13px;
    line-height: 1.5;
    font-weight: 500;
    color: rgba(15, 23, 42, 0.6);
    white-space: pre-line;
    word-break: break-word;
    overflow-y: auto;
    min-height: 0;
    flex: 1 1 auto;
    padding-right: 4px;
  }

  .wayfinder-search-info-actions {
    display: flex;
  }

  .wayfinder-search-info-description-toggle {
    align-self: flex-start;
    padding: 6px 0;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    color: rgba(15, 23, 42, 0.75);
    cursor: pointer;
  }

  .wayfinder-search-info-description-toggle:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
  }

  .wayfinder-search-info[data-description-expanded='true'] .wayfinder-search-info-description {
    display: block;
  }

  .wayfinder-search-direction {
    width: 100%;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: rgba(15, 23, 42, 0.06);
    font-size: 13px;
    line-height: 1.2;
    font-weight: 600;
    color: inherit;
  }

  @media (max-width: 768px) {
    .wayfinder-qr-dialog {
      width: calc(100vw - 24px);
      border-radius: 18px;
      padding: 18px;
    }

    .wayfinder-qr-code {
      width: min(300px, calc(100vw - 72px));
    }

    .wayfinder-search-toggle {
      display: grid;
    }

    .wayfinder-search-share {
      top: 16px;
      left: 68px;
    }

    .wayfinder-search-panel {
      display: none;
      inset: 0;
      width: auto;
      padding: 16px;
      background: rgba(224, 235, 255, 0.96);
      border-radius: 0;
    }

    .wayfinder-search-field input {
      font-size: 16px;
    }

    .wayfinder-search[data-open='true'] .wayfinder-search-panel {
      display: flex;
    }

    .wayfinder-search[data-mode='focus'] .wayfinder-search-panel {
      display: none;
    }

    .wayfinder-search[data-mode='focus'][data-open='true'] .wayfinder-search-panel {
      display: flex;
    }

    .wayfinder-search[data-mode='focus'] .wayfinder-search-toggle {
      display: grid;
    }

    .wayfinder-search[data-open='true'] .wayfinder-search-info {
      display: none !important;
    }

    .wayfinder-search[data-open='true'][data-selected='true'] .wayfinder-search-field {
      display: flex;
    }

    .wayfinder-search[data-open='true'][data-selected='true'] .wayfinder-search-selected {
      display: none;
    }

    .wayfinder-search[data-open='true'] .wayfinder-search-share {
      display: none;
    }

    .wayfinder-search-back {
      display: inline-flex;
    }

    .wayfinder-search-results {
      flex: 1;
      max-height: none;
    }

    .wayfinder-search-info {
      top: auto;
      bottom: calc(
        16px + env(safe-area-inset-bottom) +
        max(
          var(--wayfinder-viewport-inset-bottom, 0px),
          var(--wayfinder-browser-ui-offset, 0px)
        )
      );
      left: 12px;
      right: 12px;
      width: auto;
      transition: top 220ms ease, right 220ms ease, bottom 220ms ease, left 220ms ease,
        border-radius 220ms ease, box-shadow 220ms ease, opacity 180ms ease;
    }

    .wayfinder-search-info-header-actions {
      top: calc(12px + env(safe-area-inset-top));
      right: 12px;
    }

    .wayfinder-search-info-header-actions .wayfinder-search-info-close {
      display: grid;
    }

    .wayfinder-search-info-expand {
      display: grid;
    }

    .wayfinder-search-info[data-mobile-expanded='true'] {
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      max-height: none;
      border-radius: 0;
      border-color: rgba(15, 23, 42, 0.12);
      box-shadow: none;
    }

    .wayfinder-search-info[data-mobile-expanded='false'] {
      top: auto;
      right: 12px;
      bottom: calc(
        16px + env(safe-area-inset-bottom) +
        max(
          var(--wayfinder-viewport-inset-bottom, 0px),
          var(--wayfinder-browser-ui-offset, 0px)
        )
      );
      left: 12px;
    }

    .wayfinder-search-info[data-mobile-expanded='false'] .wayfinder-search-info-media,
    .wayfinder-search-info[data-mobile-expanded='false'] .wayfinder-search-info-pager,
    .wayfinder-search-info[data-mobile-expanded='false'] .wayfinder-search-info-logo,
    .wayfinder-search-info[data-mobile-expanded='false'] .wayfinder-search-info-description,
    .wayfinder-search-info[data-mobile-expanded='false'] .wayfinder-search-info-description-toggle {
      display: none !important;
    }

    .wayfinder-search-info[data-mobile-expanded='false'] .wayfinder-search-info-meta {
      gap: 0;
    }

    .wayfinder-search-info[data-mobile-expanded='false'] .wayfinder-search-info-body {
      gap: 8px;
      padding: 12px 14px 14px;
    }

    .wayfinder-search-info[data-mobile-expanded='true'] .wayfinder-search-info-body {
      overflow: auto;
      padding-top: 14px;
    }

    .wayfinder-search-info[data-mobile-expanded='true'] .wayfinder-search-info-media,
    .wayfinder-search-info[data-mobile-expanded='true'] .wayfinder-search-info-logo {
      display: block;
    }

    .wayfinder-search-info[data-mobile-expanded='true'] .wayfinder-search-info-logo {
      display: flex;
    }

    .wayfinder-search-info[data-mobile-expanded='true'] .wayfinder-search-info-description-toggle {
      display: none !important;
    }

    .wayfinder-search-info[data-mobile-expanded='true'] .wayfinder-search-info-description {
      display: block !important;
    }

    .wayfinder-search-info[data-mobile-expanded='false'] .wayfinder-search-info-description {
      display: none;
    }
  }

  /* Navigation mode - hide regular search header when in nav mode */
  .wayfinder-search[data-nav-mode='true'] .wayfinder-search-header {
    display: none;
  }

  .wayfinder-search[data-nav-mode='true'] .wayfinder-search-results {
    margin-top: 8px;
  }

  /* Navigation Header */
  .wayfinder-search-nav-header {
    padding: 8px 8px 12px 8px;
  }

  .wayfinder-search-nav-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: rgba(255, 255, 255, 0.95);
    cursor: pointer;
    font: inherit;
    color: inherit;
    font-size: 14px;
    font-weight: 500;
    transition: background 120ms ease;
  }

  .wayfinder-search-nav-back:hover {
    background: rgba(15, 23, 42, 0.06);
  }

  .wayfinder-search-nav-back:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
  }

  /* Navigation Fields Container */
  .wayfinder-search-nav-fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Individual Navigation Field — matches .wayfinder-search-field pill style */
  .wayfinder-search-nav-field {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    box-sizing: border-box;
    padding: 10px 14px;
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.2);
    background: rgba(255, 255, 255, 0.95);
    box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.4);
    cursor: text;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .wayfinder-search-nav-field[data-state='active'] {
    border-color: rgba(14, 116, 144, 0.5);
    box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.4), 0 0 0 1px rgba(14, 116, 144, 0.15);
  }

  .wayfinder-search-nav-field[data-state='filled'] {
    border-color: rgba(15, 23, 42, 0.2);
  }

  .wayfinder-search-nav-field[data-state='inactive'] {
    opacity: 0.5;
  }

  .wayfinder-search-nav-field[data-locked='true'] {
    background: rgba(255, 255, 255, 0.98);
    border-color: rgba(15, 23, 42, 0.24);
    cursor: default;
  }

  .wayfinder-search-nav-field > img {
    width: 18px;
    height: 18px;
    display: block;
    filter: none;
    flex-shrink: 0;
  }

  .wayfinder-search-nav-field input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    color: inherit;
    min-width: 0;
  }

  .wayfinder-search-nav-field input::placeholder {
    color: rgba(15, 23, 42, 0.4);
  }

  .wayfinder-search-nav-field[data-locked='true'] input {
    cursor: default;
  }

  .wayfinder-search-nav-field-clear {
    width: 20px;
    height: 20px;
    min-width: 20px;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    flex-shrink: 0;
    margin-left: 4px;
  }

  .wayfinder-search-nav-field-clear img {
    width: 14px;
    height: 14px;
    display: block;
    filter: none;
    opacity: 0.4;
    transition: opacity 0.2s;
  }

  .wayfinder-search-nav-field-clear:hover img {
    filter: none;
    opacity: 0.7;
  }

  .wayfinder-search-nav-field[data-locked='true'] .wayfinder-search-nav-field-clear {
    visibility: hidden;
    pointer-events: none;
  }

  .wayfinder-search-nav-field-clear:focus-visible {
    outline: 2px solid rgba(14, 116, 144, 0.7);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* Hide native search cancel button in navigation fields */
  .wayfinder-search-nav-field input::-webkit-search-cancel-button {
    display: none;
  }

  /* Navigation summary panel (mobile bottom card) */
  .wayfinder-search-nav-summary {
    display: none;
  }

  @media (max-width: 768px) {
    .wayfinder-search-nav-summary {
      display: none;
      position: absolute;
      bottom: calc(
        16px + env(safe-area-inset-bottom) +
        max(
          var(--wayfinder-viewport-inset-bottom, 0px),
          var(--wayfinder-browser-ui-offset, 0px)
        )
      );
      left: 12px;
      right: 12px;
      border-radius: 18px;
      border: 1px solid rgba(15, 23, 42, 0.15);
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 18px 36px -28px rgba(15, 23, 42, 0.5);
      padding: 12px 14px;
      z-index: 1;
      opacity: 0;
      visibility: hidden;
      transform: translateY(6px) scale(0.995);
      transition: opacity 200ms ease, transform 220ms ease, visibility 0s linear 220ms;
    }

    .wayfinder-search-nav-summary[data-visible='true'] {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0) scale(1);
      transition-delay: 0s, 0s, 0s;
    }

    .wayfinder-search-nav-summary-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      cursor: pointer;
    }

    .wayfinder-search-nav-summary-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .wayfinder-search-nav-summary-row img {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      filter: none;
      opacity: 0.5;
    }

    .wayfinder-search-nav-summary-row span {
      font-size: 14px;
      font-weight: 600;
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .wayfinder-search-nav-summary-close {
      width: 33px;
      height: 33px;
      flex-shrink: 0;
      border-radius: 999px;
      border: 1px solid rgba(15, 23, 42, 0.2);
      background: var(--wayfinder-control-button-bg);
      display: grid;
      place-items: center;
      cursor: pointer;
      box-shadow: 0 6px 18px -12px rgba(15, 23, 42, 0.5);
    }

    .wayfinder-search-nav-summary-close img {
      width: 12px;
      height: 12px;
      display: block;
      filter: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .wayfinder-qr-modal {
      transition: none;
    }

    .wayfinder-search-info {
      transition: none;
    }

    .wayfinder-search-info-media-track {
      scroll-behavior: auto;
    }
  }

  ::slotted(*) {
    position: absolute;
  }

  :host(.loading) .wayfinder-canvas {
    opacity: 0.5;
  }

  :host(.error) .wayfinder-canvas {
    opacity: 0.3;
  }
`;
