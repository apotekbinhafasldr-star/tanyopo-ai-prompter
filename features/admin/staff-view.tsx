import { Badge, Card, DemoNotice, Frame, Hero } from "@/features/admin/premium/parts";
import { DEMO_STAFF, PERMISSION_LABELS, type DemoStaffMember } from "@/lib/admin/demo-data";
import { PERMISSIONS, SENSITIVE_PERMISSIONS } from "@/lib/admin/permissions";

const RULES = [
  "Hanya Super Admin yang dapat mengatur akses staf.",
  "Tidak ada yang dapat mengubah akses dirinya sendiri atau mengangkat dirinya menjadi Super Admin.",
  "Super Admin baru hanya dibuat lewat proses terkontrol yang disetujui Founder, bukan dari aplikasi.",
  "Izin sensitif (refund, rekening, konfigurasi pajak, impor settlement) harus diberikan secara eksplisit.",
  "Harus selalu ada minimal satu Super Admin aktif.",
  "Pelanggan dan owner tenant tidak punya akses Admin Center.",
];

function StaffCard({ member }: { member: DemoStaffMember }) {
  const isSuper = member.role === "SUPER_ADMIN";
  return (
    <div className="fin-person">
      <div className="top">
        <div style={{ minWidth: 0 }}>
          <p className="nm">{member.name}</p>
          <p className="ti">{member.title}</p>
        </div>
        <div className="fin-tags" style={{ flexWrap: "nowrap" }}>
          <Badge tone={isSuper ? "brand" : "mute"}>{isSuper ? "Super Admin" : "Staf"}</Badge>
          {!member.isActive ? <Badge tone="bad">Nonaktif</Badge> : null}
        </div>
      </div>
      <div className="fin-tags">
        {isSuper ? (
          <Badge tone="info">Semua izin</Badge>
        ) : member.permissions.length === 0 ? (
          <span className="fin-note">Tidak ada izin</span>
        ) : (
          member.permissions.map((p) => (
            <Badge key={p} tone={SENSITIVE_PERMISSIONS.includes(p) ? "warn" : "mute"}>
              {PERMISSION_LABELS[p].label}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

/** Read-only in Phase B: the rules are enforced and tested, the write path is not enabled. */
export function StaffView({ demo }: { demo: boolean }) {
  return (
    <Frame>
      {demo ? <DemoNotice /> : null}
      <Hero title="Akses Staf" subtitle="Siapa boleh membuka modul apa di Admin Center" />

      <Card title="Daftar staf (contoh)">
        {DEMO_STAFF.map((m) => (
          <StaffCard key={m.name} member={m} />
        ))}
        <button type="button" disabled aria-disabled="true" className="fin-btn">
          Ubah akses staf
        </button>
        <p className="fin-note">Belum aktif. Perubahan akses dibuka setelah migrasi disetujui Founder dan diterapkan.</p>
      </Card>

      <Card title="Daftar izin">
        {PERMISSIONS.map((p) => (
          <div key={p} className="fin-row">
            <span>{PERMISSION_LABELS[p].label}</span>
            {PERMISSION_LABELS[p].sensitive ? <Badge tone="warn">Sensitif</Badge> : <span />}
          </div>
        ))}
      </Card>

      <Card title="Aturan akses">
        <ul className="fin-rules">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Card>

      <p className="fin-note">Tidak ada alamat email yang diberi hak khusus. Hak akses hanya berasal dari baris admin di database.</p>
    </Frame>
  );
}
