import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import PrivacyPage from "@/app/(legal)/privacy/page";

const ORIGINAL = process.env.TRIAL_ABUSE_MODE;
afterEach(() => {
  cleanup();
  if (ORIGINAL === undefined) delete process.env.TRIAL_ABUSE_MODE;
  else process.env.TRIAL_ABUSE_MODE = ORIGINAL;
});

function text(mode: string | undefined): string {
  if (mode === undefined) delete process.env.TRIAL_ABUSE_MODE;
  else process.env.TRIAL_ABUSE_MODE = mode;
  const { container } = render(<PrivacyPage />);
  return container.textContent ?? "";
}

describe("privacy notice follows the anti-abuse switch", () => {
  it("OFF (default): no anti-abuse collection is described, and the in-memory-only IP statement stays accurate", () => {
    for (const mode of [undefined, "", "off"]) {
      const t = text(mode);
      expect(t).not.toMatch(/Perlindungan masa uji coba/);
      expect(t).not.toMatch(/lnx_dv/);
      expect(t).toMatch(/alamat IP tidak kami simpan pada tabel data LINOE/);
      cleanup();
    }
  });

  it.each(["shadow", "enforce"])("%s: discloses pseudonyms, the cookie, retention, limits and human review — and drops the 'IP not stored' claim", (mode) => {
    const t = text(mode);
    expect(t).toMatch(/Perlindungan masa uji coba/);
    expect(t).toMatch(/kode samaran/);
    expect(t).toMatch(/tidak memakai\s+pengambilan sidik jari lewat canvas, WebGL, atau audio/);
    expect(t).toMatch(/tidak melacak Anda di situs lain/);
    expect(t).toMatch(/bukan nilai aslinya/);
    expect(t).toMatch(/lnx_dv/);
    expect(t).toMatch(/90 hari/);
    expect(t).toMatch(/peninjauan oleh manusia/);
    expect(t).toMatch(/tanyopofuturetechnology@gmail\.com/);
    expect(t).not.toMatch(/alamat IP tidak kami simpan pada tabel data LINOE/);
  });

  it("an invalid mode does not claim collection that is not happening", () => {
    expect(text("enforec")).not.toMatch(/Perlindungan masa uji coba/);
  });
});
