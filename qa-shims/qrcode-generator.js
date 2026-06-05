// QA stub: qrcode-generator is a Phase-3 (qr-share) dependency, not declared/installed.
// Floor-rendering does not exercise QR. This stub satisfies the import so the
// component module graph loads for the floor-rendering browser smoke.
export default function qrcode() {
  return {
    addData() {},
    make() {},
    createDataURL() { return 'data:image/gif;base64,R0lGODlhAQABAAAAACw='; },
    createSvgTag() { return '<svg/>'; },
    getModuleCount() { return 0; },
    isDark() { return false; }
  };
}
