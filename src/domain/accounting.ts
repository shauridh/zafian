import type { StockMovement } from './inventory'
import type { CashMovement, Transaction } from './pos'

export type ExpenseCategory = 'Bahan' | 'Gaji' | 'Sewa' | 'Listrik & air' | 'Internet' | 'Transportasi' | 'Perawatan' | 'Platform' | 'Lain-lain'

export type Expense = {
  id: string
  createdAt: string
  category: ExpenseCategory
  amount: number
  note: string
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export type Account = { code: string; name: string; type: AccountType }

export type JournalLine = { account: string; debit: number; credit: number }

export type JournalEntry = {
  id: string
  date: string
  description: string
  source: 'sale' | 'cogs' | 'cash' | 'purchase' | 'opname' | 'expense'
  lines: JournalLine[]
}

export const chartOfAccounts: Account[] = [
  { code: '1000', name: 'Kas Kasir', type: 'asset' },
  { code: '1100', name: 'Piutang QRIS', type: 'asset' },
  { code: '1150', name: 'Piutang Platform & Pelanggan', type: 'asset' },
  { code: '1200', name: 'Persediaan Bahan', type: 'asset' },
  { code: '2000', name: 'DP Pelanggan', type: 'liability' },
  { code: '3000', name: 'Modal Pemilik', type: 'equity' },
  { code: '3100', name: 'Setoran Pemilik', type: 'equity' },
  { code: '3200', name: 'Prive Pemilik', type: 'equity' },
  { code: '4000', name: 'Penjualan', type: 'revenue' },
  { code: '5000', name: 'Harga Pokok Penjualan', type: 'expense' },
  { code: '6000', name: 'Beban Operasional', type: 'expense' },
  { code: '6100', name: 'Selisih Persediaan', type: 'expense' },
  { code: '6900', name: 'Selisih Kas', type: 'expense' },
]

type BuildInput = {
  transactions: Transaction[]
  cashMovements: CashMovement[]
  stockMovements: StockMovement[]
  expenses: Expense[]
  hppOf: (transaction: Transaction) => number
}

export function buildJournals({ transactions, cashMovements, stockMovements, expenses, hppOf }: BuildInput): JournalEntry[] {
  const entries: JournalEntry[] = []

  for (const transaction of transactions) {
    if (transaction.status !== 'completed') continue
    const paid = Math.min(Math.max(0, transaction.paidAmount), transaction.subtotal)
    const receivable = Math.max(0, transaction.subtotal - paid)
    const debitAccount = transaction.paymentMethod === 'QRIS' ? '1100' : transaction.paymentMethod === 'Unpaid' ? '1150' : '1000'
    const lines: JournalLine[] = []
    if (paid > 0) lines.push({ account: debitAccount, debit: paid, credit: 0 })
    if (receivable > 0) lines.push({ account: '1150', debit: receivable, credit: 0 })
    lines.push({ account: '4000', debit: 0, credit: transaction.subtotal })
    entries.push({
      id: `${transaction.id}-sale`,
      date: transaction.createdAt,
      description: `Penjualan ${transaction.number}`,
      source: 'sale',
      lines,
    })

    const hpp = hppOf(transaction)
    if (hpp > 0) {
      entries.push({
        id: `${transaction.id}-cogs`,
        date: transaction.createdAt,
        description: `HPP ${transaction.number}`,
        source: 'cogs',
        lines: [
          { account: '5000', debit: hpp, credit: 0 },
          { account: '1200', debit: 0, credit: hpp },
        ],
      })
    }
  }

  for (const movement of cashMovements) {
    const isDp = movement.note.toLowerCase().startsWith('dp')
    const isSettlement = movement.note.toLowerCase().startsWith('pelunasan')
    entries.push({
      id: `${movement.id}-cash`,
      date: movement.createdAt,
      description: `${movement.type === 'in' ? 'Kas masuk' : 'Kas keluar'} — ${movement.note}`,
      source: 'cash',
      lines: movement.type === 'in'
        ? [
            { account: '1000', debit: movement.amount, credit: 0 },
            { account: isDp ? '2000' : isSettlement ? '1150' : '3100', debit: 0, credit: movement.amount },
          ]
        : [
            { account: '3200', debit: movement.amount, credit: 0 },
            { account: '1000', debit: 0, credit: movement.amount },
          ],
    })
  }

  for (const movement of stockMovements) {
    if (movement.type === 'purchase' && movement.totalCost > 0) {
      entries.push({
        id: `${movement.id}-purchase`,
        date: movement.createdAt,
        description: `Pembelian bahan — ${movement.note}`,
        source: 'purchase',
        lines: [
          { account: '1200', debit: movement.totalCost, credit: 0 },
          { account: '1000', debit: 0, credit: movement.totalCost },
        ],
      })
    }
    if (movement.type !== 'opname' || movement.qty === 0) continue
    // Selisih opname dinilai dengan biaya snapshot agar laporan tidak berubah saat harga bahan naik.
    const value = Math.round(Math.abs(movement.qty) * (movement.unitCost ?? 0) * 100) / 100
    if (value <= 0) continue
    const shortage = movement.qty < 0
    entries.push({
      id: `${movement.id}-opname`,
      date: movement.createdAt,
      description: `Opname stok — ${movement.note}`,
      source: 'opname',
      lines: shortage
        ? [
            { account: '6100', debit: value, credit: 0 },
            { account: '1200', debit: 0, credit: value },
          ]
        : [
            { account: '1200', debit: value, credit: 0 },
            { account: '6100', debit: 0, credit: value },
          ],
    })
  }

  for (const expense of expenses) {
    entries.push({
      id: `${expense.id}-expense`,
      date: expense.createdAt,
      description: `Beban ${expense.category} — ${expense.note}`,
      source: 'expense',
      lines: [
        { account: '6000', debit: expense.amount, credit: 0 },
        { account: '1000', debit: 0, credit: expense.amount },
      ],
    })
  }

  return entries
}

export type LedgerRow = { code: string; name: string; type: AccountType; debit: number; credit: number; balance: number }

export function ledger(entries: JournalEntry[]): LedgerRow[] {
  return chartOfAccounts.map((account) => {
    let debit = 0
    let credit = 0
    for (const entry of entries) {
      for (const line of entry.lines) {
        if (line.account !== account.code) continue
        debit += line.debit
        credit += line.credit
      }
    }
    const signed = account.type === 'asset' || account.type === 'expense' ? debit - credit : credit - debit
    return { ...account, debit, credit, balance: signed }
  })
}

export function trialBalance(entries: JournalEntry[]): { rows: LedgerRow[]; debit: number; credit: number; balanced: boolean } {
  const rows = ledger(entries)
  const debit = rows.reduce((sum, row) => sum + row.debit, 0)
  const credit = rows.reduce((sum, row) => sum + row.credit, 0)
  return { rows, debit, credit, balanced: Math.abs(debit - credit) < 0.01 }
}

export function pnl(entries: JournalEntry[]): { revenue: number; cogs: number; grossProfit: number; inventoryAdjustment: number; operatingExpenses: number; netProfit: number } {
  const rows = ledger(entries)
  const balanceOf = (code: string) => rows.find((row) => row.code === code)?.balance ?? 0
  const revenue = balanceOf('4000')
  const cogs = balanceOf('5000')
  const inventoryAdjustment = balanceOf('6100')
  const operatingExpenses = balanceOf('6000') + inventoryAdjustment + balanceOf('6900')
  const grossProfit = revenue - cogs
  return { revenue, cogs, grossProfit, inventoryAdjustment, operatingExpenses, netProfit: grossProfit - operatingExpenses }
}

export function balanceSheet(entries: JournalEntry[]): { assets: LedgerRow[]; liabilities: LedgerRow[]; equity: LedgerRow[]; totalAssets: number; totalLiabilities: number; totalEquity: number; netProfit: number } {
  const rows = ledger(entries)
  const assets = rows.filter((row) => row.type === 'asset' && row.balance !== 0)
  const liabilities = rows.filter((row) => row.type === 'liability' && row.balance !== 0)
  const equity = rows.filter((row) => row.type === 'equity' && row.balance !== 0)
  const totalAssets = assets.reduce((sum, row) => sum + row.balance, 0)
  const totalLiabilities = liabilities.reduce((sum, row) => sum + row.balance, 0)
  const netProfit = pnl(entries).netProfit
  const totalEquity = equity.reduce((sum, row) => sum + row.balance, 0) + netProfit
  return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, netProfit }
}
