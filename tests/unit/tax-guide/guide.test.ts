import { describe, expect, it } from "vitest";
import {
  CORETAX_PORTAL,
  GUIDE_SOURCES,
  SECRETS_WARNING,
  annualFilingDeadline,
  assessReadiness,
  canMarkDone,
  kindSlug,
  parseGuideYear,
  parseReturnKind,
  parseStepParam,
  sourceById,
  sourcesFor,
  stepsFor,
  usableObligations,
  type ReadinessInput,
} from "@/lib/tax-guide";

const READY: ReadinessInput = {
  kind: "PPH_BADAN",
  demo: false,
  checks: [{ label: "Neraca seimbang", ok: true }],
  bankFinal: true,
  entityComplete: true,
  statementsApproved: true,
  taxRateVerified: true,
  pendingAdjustments: 0,
  pkpVerified: true,
  invoiceDataAvailable: true,
};
const codes = (i: Partial<ReadinessInput>) => assessReadiness({ ...READY, ...i }).blockers.map((b) => b.code);

describe("wizard steps follow the Founder's required order", () => {
  it("PPh Badan has the 15 steps in order", () => {
    expect(stepsFor("PPH_BADAN").map((s) => s.title)).toEqual([
      "Periksa identitas dan akses Coretax",
      "Pilih tahun atau masa pajak",
      "Periksa kelengkapan pembukuan seluruh PT",
      "Periksa laporan laba rugi dan neraca",
      "Periksa rekonsiliasi fiskal",
      "Periksa perhitungan pajak",
      "Siapkan dokumen dan lampiran",
      "Unduh Paket Coretax",
      "Buka portal Coretax resmi",
      "Ikuti panduan pengisian SPT",
      "Periksa validasi dan kewajiban pembayaran",
      "Lakukan pembayaran jika diperlukan",
      "Tandatangani dan kirim SPT melalui Coretax",
      "Simpan bukti pembayaran dan Bukti Penerimaan Elektronik",
      "Tandai selesai setelah bukti resmi diverifikasi",
    ]);
  });

  it("numbers are sequential and ids unique for both types", () => {
    for (const k of ["PPH_BADAN", "PPN"] as const) {
      const s = stepsFor(k);
      expect(s.map((x) => x.n)).toEqual(s.map((_, i) => i + 1));
      expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    }
  });

  it("PPN skips the annual-only steps (fiscal reconciliation, calculation, statements, package)", () => {
    const ids = stepsFor("PPN").map((s) => s.id);
    for (const id of ["laporan", "fiskal", "hitung", "paket"]) expect(ids).not.toContain(id);
    expect(ids).toContain("faktur");
    expect(stepsFor("PPN").some((s) => s.isPackage)).toBe(false);
  });

  it("the package step and the final step exist exactly once for PPh Badan", () => {
    const s = stepsFor("PPH_BADAN");
    expect(s.filter((x) => x.isPackage)).toHaveLength(1);
    expect(s.filter((x) => x.isFinal)).toHaveLength(1);
    expect(s[s.length - 1].isFinal).toBe(true);
  });
});

describe("official sources are cited, never invented", () => {
  it("every source is an https DJP page with a page date and a verification date", () => {
    expect(GUIDE_SOURCES.length).toBeGreaterThan(0);
    for (const s of GUIDE_SOURCES) {
      expect(s.url).toMatch(/^https:\/\/(www\.)?pajak\.go\.id\//);
      expect(s.pageDate.length).toBeGreaterThan(3);
      expect(s.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.publisher).toBe("DJP");
    }
    expect(CORETAX_PORTAL.url).toBe("https://coretaxdjp.pajak.go.id");
  });

  it("every cited source id exists and supports the chosen type", () => {
    for (const k of ["PPH_BADAN", "PPN"] as const) {
      const allowed = new Set(sourcesFor(k).map((s) => s.id));
      for (const st of stepsFor(k)) for (const id of st.sourceIds) {
        expect(sourceById(id), `${k}/${st.id}`).toBeDefined();
        expect(allowed.has(id), `${k}/${st.id} cites ${id}`).toBe(true);
      }
    }
  });

  it("every link inside a step is an official DJP/Coretax page or an internal admin page", () => {
    for (const k of ["PPH_BADAN", "PPN"] as const) {
      for (const st of stepsFor(k)) for (const l of st.links) {
        if (l.kind === "official") expect(l.href).toMatch(/^https:\/\/(www\.)?(pajak\.go\.id|coretaxdjp\.pajak\.go\.id)(\/|$)/);
        else expect(l.href).toMatch(/^\/admin\//);
      }
    }
  });

  it("a procedure not backed by a read source is labelled unverified and carries a warning", () => {
    for (const k of ["PPH_BADAN", "PPN"] as const) {
      for (const st of stepsFor(k)) {
        if (st.verification === "BELUM") expect(st.warning, `${k}/${st.id}`).toBeTruthy();
        if (st.verification === "TERVERIFIKASI" && st.actor === "FOUNDER") expect(st.sourceIds.length, `${k}/${st.id}`).toBeGreaterThan(0);
      }
    }
    // Proof of receipt (BPE) was not found on a read official page: it must not be presented as verified.
    expect(stepsFor("PPH_BADAN").find((s) => s.id === "bukti")?.verification).toBe("BELUM");
    // PPN submission steps are not described by the page that was read.
    const ppn = stepsFor("PPN");
    for (const id of ["isi", "validasi", "bayar", "kirim"]) expect(ppn.find((s) => s.id === id)?.verification).toBe("BELUM");
  });
});

describe("security: no credentials, no automation", () => {
  it("never asks to type a password/OTP/authorization code/passphrase here", () => {
    const all = (["PPH_BADAN", "PPN"] as const).flatMap(stepsFor);
    for (const st of all) {
      for (const t of [...st.todo, st.why]) {
        expect(t, st.id).not.toMatch(/(masukkan|ketik|isi|kirim)[^.]*(kata sandi|password|otp|kode otorisasi)(?![^.]*\bdi Coretax)/i);
      }
    }
    expect(SECRETS_WARNING).toMatch(/tidak memintanya/);
    // The only place a passphrase is mentioned says it is typed in Coretax only.
    const kirim = stepsFor("PPH_BADAN").find((s) => s.id === "kirim");
    expect(kirim?.todo.join(" ")).toMatch(/hanya diketik di Coretax/);
  });

  it("no step claims automatic login, filing or payment", () => {
    const text = (["PPH_BADAN", "PPN"] as const).flatMap(stepsFor).map((s) => [s.title, s.why, ...s.todo, s.warning ?? ""].join(" ")).join(" ");
    expect(text).not.toMatch(/otomatis (masuk|login|mengirim|membayar|lapor)/i);
    expect(text).not.toMatch(/file (xml|impor) (siap|otomatis)/i);
  });
});

describe("readiness: BELUM SIAP LAPOR unless nothing blocks", () => {
  it("is ready only with every prerequisite met", () => {
    const r = assessReadiness(READY);
    expect(r.status).toBe("SIAP_LAPOR");
    expect(r.label).toBe("SIAP LAPOR");
    expect(r.blockers).toEqual([]);
    expect(r.note).toMatch(/Bukti Penerimaan Elektronik/);
  });

  it("demo data is never ready", () => {
    const r = assessReadiness({ ...READY, demo: true });
    expect(r.label).toBe("BELUM SIAP LAPOR");
    expect(r.blockers.map((b) => b.code)).toContain("DEMO_DATA");
  });

  it("each missing prerequisite blocks on its own", () => {
    expect(codes({ entityComplete: false })).toEqual(["ENTITY_INCOMPLETE"]);
    expect(codes({ bankFinal: false })).toEqual(["BANK_NOT_FINAL"]);
    expect(codes({ statementsApproved: false })).toEqual(["STATEMENTS_DRAFT"]);
    expect(codes({ taxRateVerified: false })).toEqual(["RATE_NOT_VERIFIED"]);
    expect(codes({ pendingAdjustments: 2 })).toEqual(["ADJ_PENDING"]);
    expect(codes({ checks: [{ label: "Neraca seimbang", ok: false }] })).toEqual(["CHECK_FAILED"]);
  });

  it("LINOE-only data (entity incomplete) is never reported as the whole PT", () => {
    const r = assessReadiness({ ...READY, entityComplete: false });
    expect(r.status).toBe("BELUM_SIAP_LAPOR");
    expect(r.blockers[0].text).toMatch(/hanya satu segmen/);
  });

  it("PPN needs a verified PKP status and does not use annual-return prerequisites", () => {
    expect(codes({ kind: "PPN", pkpVerified: false })).toEqual(["PKP_NOT_VERIFIED"]);
    expect(codes({ kind: "PPN", invoiceDataAvailable: false })).toEqual(["INVOICE_DATA_MISSING"]);
    expect(codes({ kind: "PPN", taxRateVerified: false, statementsApproved: false, pendingAdjustments: 3 })).toEqual([]);
  });

  it("every blocker points at a step that exists for that type", () => {
    for (const kind of ["PPH_BADAN", "PPN"] as const) {
      const ids = new Set(stepsFor(kind).map((s) => s.id));
      const r = assessReadiness({ ...READY, kind, demo: true, entityComplete: false, bankFinal: false, statementsApproved: false, taxRateVerified: false, pendingAdjustments: 1, pkpVerified: false, invoiceDataAvailable: false, checks: [{ label: "x", ok: false }] });
      for (const b of r.blockers) for (const id of b.stepIds) expect(ids.has(id), `${kind}/${b.code}->${id}`).toBe(true);
    }
  });
});

describe("completion is a note, not proof", () => {
  it("needs both official proofs", () => {
    expect(canMarkDone({ statusDilaporkan: false, bpeChecked: false })).toBe(false);
    expect(canMarkDone({ statusDilaporkan: true, bpeChecked: false })).toBe(false);
    expect(canMarkDone({ statusDilaporkan: false, bpeChecked: true })).toBe(false);
    expect(canMarkDone({ statusDilaporkan: true, bpeChecked: true })).toBe(true);
  });
});

describe("inputs, deadlines and other obligations", () => {
  it("parses only known return types and years", () => {
    expect(parseReturnKind("pph-badan")).toBe("PPH_BADAN");
    expect(parseReturnKind(["ppn", "x"])).toBe("PPN");
    expect(parseReturnKind("lainnya")).toBe("LAINNYA");
    expect(parseReturnKind("<script>")).toBeNull();
    expect(parseReturnKind(undefined)).toBeNull();
    expect(kindSlug("PPH_BADAN")).toBe("pph-badan");
    expect(parseGuideYear("2026", ["2026"])).toBe("2026");
    expect(parseGuideYear("1999", ["2026"])).toBe("2026");
    expect(parseGuideYear(undefined, ["2025", "2026"])).toBe("2026");
  });

  it("deep-link step accepts only a plain small number", () => {
    expect(parseStepParam("3")).toBe(3);
    expect(parseStepParam(["12", "x"])).toBe(12);
    for (const bad of ["0", "-1", "abc", "1e3", "999", "3; DROP", "", undefined]) expect(parseStepParam(bad), String(bad)).toBeUndefined();
  });

  it("annual deadline is the end of the fourth month after a calendar year", () => {
    expect(annualFilingDeadline("2026")).toBe("2027-04-30");
    expect(annualFilingDeadline("x")).toBeNull();
  });

  it("other obligations are listed only when verified by a named person and time", () => {
    expect(usableObligations([])).toEqual([]);
    expect(usableObligations([{ name: "PPh 21", verifiedBy: null, verifiedAt: null }, { name: "PPh 23", verifiedBy: " ", verifiedAt: "2026-01-01" }])).toEqual([]);
    expect(usableObligations([{ name: "PPh 23", verifiedBy: "akuntan", verifiedAt: "2026-01-01T00:00:00Z" }]).map((o) => o.name)).toEqual(["PPh 23"]);
  });
});
