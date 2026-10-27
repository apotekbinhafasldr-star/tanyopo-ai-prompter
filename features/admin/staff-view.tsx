import { DemoBanner, DisabledAction, Notice, PageTitle, Section, StatusBadge } from "@/features/admin/ui";
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
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{member.name}</p>
          <p className="truncate text-xs text-muted-foreground">{member.title}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <StatusBadge variant={isSuper ? "brand" : "neutral"}>{isSuper ? "Super Admin" : "Staf"}</StatusBadge>
          {!member.isActive ? <StatusBadge variant="danger">Nonaktif</StatusBadge> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {isSuper ? (
          <StatusBadge variant="info">Semua izin</StatusBadge>
        ) : member.permissions.length === 0 ? (
          <span className="text-xs text-muted-foreground">Tidak ada izin</span>
        ) : (
          member.permissions.map((p) => (
            <StatusBadge key={p} variant={SENSITIVE_PERMISSIONS.includes(p) ? "warning" : "neutral"}>
              {PERMISSION_LABELS[p].label}
            </StatusBadge>
          ))
        )}
      </div>
    </li>
  );
}

/** Read-only in Phase B: the rules are enforced and tested, the write path is not enabled. */
export function StaffView({ demo }: { demo: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {demo ? <DemoBanner /> : null}
      <PageTitle title="Akses Staf" description="Siapa boleh membuka modul apa di Admin Center." />

      <Section title="Daftar staf (contoh)">
        <ul className="flex flex-col divide-y divide-border">
          {DEMO_STAFF.map((m) => (
            <StaffCard key={m.name} member={m} />
          ))}
        </ul>
        <div className="mt-4">
          <DisabledAction
            label="Ubah akses staf"
            reason="Belum aktif. Perubahan akses dibuka setelah migrasi disetujui Founder dan diterapkan."
          />
        </div>
      </Section>

      <Section title="Daftar izin">
        <ul className="flex flex-col divide-y divide-border">
          {PERMISSIONS.map((p) => (
            <li key={p} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
              <p className="text-sm text-foreground">{PERMISSION_LABELS[p].label}</p>
              {PERMISSION_LABELS[p].sensitive ? <StatusBadge variant="warning">Sensitif</StatusBadge> : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Aturan akses">
        <ul className="list-disc pl-5 text-sm text-foreground">
          {RULES.map((r) => (
            <li key={r} className="py-0.5">
              {r}
            </li>
          ))}
        </ul>
      </Section>

      <Notice tone="info">Tidak ada alamat email yang diberi hak khusus. Hak akses hanya berasal dari baris admin di database.</Notice>
    </div>
  );
}
