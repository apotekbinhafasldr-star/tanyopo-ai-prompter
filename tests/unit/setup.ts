import "@testing-library/jest-dom/vitest";

// jsdom belum tentu menyediakan HTMLDialogElement.showModal/show/close (Paket 5a). Polyfill minimal yang meniru perilaku yang diuji:
// atribut `open`, kejadian `close`. Tidak meniru inert/top-layer (itu perilaku browser, tidak diuji di jsdom).
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (!("open" in HTMLDialogElement.prototype)) {
    Object.defineProperty(HTMLDialogElement.prototype, "open", {
      configurable: true,
      get(this: HTMLDialogElement) {
        return this.hasAttribute("open");
      },
      set(this: HTMLDialogElement, value: boolean) {
        if (value) this.setAttribute("open", "");
        else this.removeAttribute("open");
      },
    });
  }
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.show !== "function") {
    proto.show = function show(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
