/**
 * Chart of Accounts (Bagan Akun).
 *
 * The default list below is a PROPOSED TEMPLATE for review by the company's
 * accountant. It carries structure only: no balances, no opening amounts.
 */

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type NormalSide = "DEBIT" | "CREDIT";
/** CASH = cash/bank accounts themselves. The others classify the COUNTER side of a cash movement. */
export type CashFlowClass = "CASH" | "OPERATING" | "INVESTING" | "FINANCING";

export interface Account {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  /** Header accounts group others and can never receive a journal line. */
  readonly postable: boolean;
  /** A contra account carries the opposite normal side of its type (e.g. accumulated depreciation). */
  readonly contra?: boolean;
  readonly cashFlow?: CashFlowClass;
  readonly parent?: string;
}

export class ChartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChartError";
  }
}

export function normalSide(account: Pick<Account, "type" | "contra">): NormalSide {
  const natural: NormalSide = account.type === "ASSET" || account.type === "EXPENSE" ? "DEBIT" : "CREDIT";
  if (!account.contra) return natural;
  return natural === "DEBIT" ? "CREDIT" : "DEBIT";
}

export class ChartOfAccounts {
  private readonly byCode = new Map<string, Account>();

  constructor(accounts: readonly Account[]) {
    for (const a of accounts) {
      if (!/^\d{4}$/.test(a.code)) throw new ChartError(`Account code must be 4 digits: ${a.code}`);
      if (!a.name.trim()) throw new ChartError(`Account ${a.code} needs a name`);
      if (this.byCode.has(a.code)) throw new ChartError(`Duplicate account code ${a.code}`);
      this.byCode.set(a.code, a);
    }
    const parents = new Set<string>();
    for (const a of accounts) {
      if (a.parent !== undefined) {
        const parent = this.byCode.get(a.parent);
        if (!parent) throw new ChartError(`Account ${a.code} has unknown parent ${a.parent}`);
        if (parent.postable) throw new ChartError(`Parent ${a.parent} must be a header account`);
        if (parent.type !== a.type) throw new ChartError(`Account ${a.code} and its parent differ in type`);
        parents.add(a.parent);
      }
    }
    for (const a of accounts) {
      if (a.postable && parents.has(a.code)) throw new ChartError(`Postable account ${a.code} cannot have children`);
    }
  }

  get(code: string): Account | undefined {
    return this.byCode.get(code);
  }

  list(): Account[] {
    return [...this.byCode.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  }

  isPostable(code: string): boolean {
    return this.byCode.get(code)?.postable === true;
  }
}

const A = (code: string, name: string, type: AccountType, extra: Partial<Account> = {}): Account => ({
  code,
  name,
  type,
  postable: true,
  ...extra,
});
const H = (code: string, name: string, type: AccountType): Account => ({ code, name, type, postable: false });

/** Proposed template. Needs the accountant's review before real use. */
export const DEFAULT_ACCOUNTS: readonly Account[] = [
  H("1000", "Aset", "ASSET"),
  A("1110", "Kas dan Bank", "ASSET", { parent: "1000", cashFlow: "CASH" }),
  A("1120", "Dana di Gateway Pembayaran (Clearing)", "ASSET", { parent: "1000", cashFlow: "OPERATING" }),
  A("1210", "Piutang Usaha", "ASSET", { parent: "1000", cashFlow: "OPERATING" }),
  A("1310", "Pajak Dibayar di Muka", "ASSET", { parent: "1000", cashFlow: "OPERATING" }),
  A("1320", "PPN Masukan", "ASSET", { parent: "1000", cashFlow: "OPERATING" }),
  A("1510", "Aset Tetap", "ASSET", { parent: "1000", cashFlow: "INVESTING" }),
  A("1519", "Akumulasi Penyusutan", "ASSET", { parent: "1000", contra: true, cashFlow: "INVESTING" }),

  H("2000", "Liabilitas", "LIABILITY"),
  A("2110", "Utang Usaha", "LIABILITY", { parent: "2000", cashFlow: "OPERATING" }),
  A("2120", "Pendapatan Diterima di Muka", "LIABILITY", { parent: "2000", cashFlow: "OPERATING" }),
  A("2130", "Beban Akrual", "LIABILITY", { parent: "2000", cashFlow: "OPERATING" }),
  A("2210", "Utang PPN Keluaran", "LIABILITY", { parent: "2000", cashFlow: "OPERATING" }),
  A("2220", "Utang Pajak Penghasilan", "LIABILITY", { parent: "2000", cashFlow: "OPERATING" }),
  A("2310", "Pinjaman Pemegang Saham", "LIABILITY", { parent: "2000", cashFlow: "FINANCING" }),

  H("3000", "Ekuitas", "EQUITY"),
  A("3100", "Modal Disetor", "EQUITY", { parent: "3000", cashFlow: "FINANCING" }),
  A("3200", "Laba Ditahan", "EQUITY", { parent: "3000", cashFlow: "OPERATING" }),

  H("4000", "Pendapatan", "REVENUE"),
  A("4100", "Pendapatan Langganan", "REVENUE", { parent: "4000", cashFlow: "OPERATING" }),
  A("4900", "Refund dan Potongan Pendapatan", "REVENUE", { parent: "4000", contra: true, cashFlow: "OPERATING" }),

  H("5000", "Beban Pokok Pendapatan", "EXPENSE"),
  A("5100", "Biaya Gateway Pembayaran", "EXPENSE", { parent: "5000", cashFlow: "OPERATING" }),

  H("6000", "Beban Operasional", "EXPENSE"),
  A("6100", "Hosting dan Infrastruktur", "EXPENSE", { parent: "6000", cashFlow: "OPERATING" }),
  A("6200", "API AI", "EXPENSE", { parent: "6000", cashFlow: "OPERATING" }),
  A("6300", "Pemasaran", "EXPENSE", { parent: "6000", cashFlow: "OPERATING" }),
  A("6400", "Gaji dan Honor", "EXPENSE", { parent: "6000", cashFlow: "OPERATING" }),
  A("6500", "Jasa Profesional", "EXPENSE", { parent: "6000", cashFlow: "OPERATING" }),
  A("6600", "Penyusutan", "EXPENSE", { parent: "6000", cashFlow: "OPERATING" }),
  A("6900", "Beban Lain-lain Operasional", "EXPENSE", { parent: "6000", cashFlow: "OPERATING" }),
];

export function defaultChart(): ChartOfAccounts {
  return new ChartOfAccounts(DEFAULT_ACCOUNTS);
}

/** Maps a free-text expense category to an expense account. Unknown categories go to 6900, never dropped. */
export const DEFAULT_EXPENSE_ACCOUNT_MAP: Readonly<Record<string, string>> = {
  hosting: "6100",
  infrastruktur: "6100",
  "api ai": "6200",
  ai: "6200",
  pemasaran: "6300",
  marketing: "6300",
  gaji: "6400",
  honor: "6400",
  profesional: "6500",
  akuntan: "6500",
};

export function expenseAccountFor(category: string, map: Readonly<Record<string, string>> = DEFAULT_EXPENSE_ACCOUNT_MAP): string {
  return map[category.trim().toLowerCase()] ?? "6900";
}
