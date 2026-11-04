"use client";

import { useState } from "react";
import { Badge, Card } from "@/features/admin/premium/parts";

export interface StaffItem {
  userId: string;
  email: string | null;
  role: string;
  isActive: boolean;
  permissions: string[];
}
export interface PermOption {
  value: string;
  label: string;
  sensitive: boolean;
}

/** Live staff list plus the Founder-only form. Only plain strings cross into this component. */
export function StaffManager({ items, options, canManage, message }: { items: StaffItem[]; options: PermOption[]; canManage: boolean; message: { ok: boolean; text: string } | null }) {
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  const edit = (it: StaffItem) => {
    setEmail(it.email ?? "");
    setPicked(it.permissions);
    setActive(it.isActive);
  };
  const toggle = (v: string) => setPicked((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  return (
    <>
      <Card title="Daftar staf" sub="Data langsung dari database.">
        {items.map((m) => {
          const isSuper = m.role === "SUPER_ADMIN";
          return (
            <div className="fin-person" key={m.userId}>
              <div className="top">
                <div style={{ minWidth: 0 }}>
                  <p className="nm">{m.email ?? "Email tidak ditemukan"}</p>
                </div>
                <div className="fin-tags" style={{ flexWrap: "nowrap" }}>
                  <Badge tone={isSuper ? "brand" : "mute"}>{isSuper ? "Super Admin" : "Staf"}</Badge>
                  {!m.isActive ? <Badge tone="bad">Nonaktif</Badge> : null}
                </div>
              </div>
              <div className="fin-tags">
                {isSuper ? (
                  <Badge tone="info">Semua izin</Badge>
                ) : m.permissions.length === 0 ? (
                  <span className="fin-note">Tidak ada izin</span>
                ) : (
                  m.permissions.map((p) => {
                    const o = options.find((x) => x.value === p);
                    return (
                      <Badge key={p} tone={o?.sensitive ? "warn" : "mute"}>
                        {o?.label ?? p}
                      </Badge>
                    );
                  })
                )}
              </div>
              {canManage && !isSuper ? (
                <button type="button" className="fin-link" onClick={() => edit(m)}>
                  Ubah akses
                </button>
              ) : null}
            </div>
          );
        })}
      </Card>

      {message ? (
        <p className={`fin-msg ${message.ok ? "ok" : "no"}`} role="status">
          {message.text}
        </p>
      ) : null}

      {canManage ? (
        <Card title="Tambah atau ubah staf" sub="Orangnya harus sudah punya akun. Akses baru berlaku di permintaan berikutnya.">
          <form method="post" action="/admin/staff/save" className="fin-form">
            <label className="fin-field">
              Email akun
              <input type="email" name="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Alamat email akun" />
            </label>
            <div className="fin-opts" role="group" aria-label="Izin">
              {options.map((o) => (
                <label className="fin-opt" key={o.value}>
                  <input type="checkbox" name="permissions" value={o.value} checked={picked.includes(o.value)} onChange={() => toggle(o.value)} />
                  <span>
                    {o.label} {o.sensitive ? <Badge tone="warn">Sensitif</Badge> : null}
                  </span>
                </label>
              ))}
            </div>
            <label className="fin-opt">
              <input type="checkbox" name="isActive" checked={active} onChange={(e) => setActive(e.target.checked)} />
              <span>Akun staf aktif</span>
            </label>
            <button type="submit" className="fin-btn">
              SIMPAN AKSES STAF
            </button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
