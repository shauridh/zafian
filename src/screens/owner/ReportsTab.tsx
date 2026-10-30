import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'

import { balanceSheet, buildJournals, pnl, trialBalance, type Expense, type ExpenseCategory } from '../../domain/accounting'
import { cogsForTransactions } from '../../domain/inventory'
import { createId } from '../../lib/id'
import type { OwnerTabProps } from './types'
import { money } from './ui'

const expenseCategories: ExpenseCategory[] = ['Bahan', 'Gaji', 'Sewa', 'Listrik & air', 'Internet', 'Transportasi', 'Perawatan', 'Platform', 'Lain-lain']

export function ReportsTab({ store, setStore, notify }: Pick<OwnerTabProps, 'store' | 'setStore' | 'notify'>) {
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory>('Lain-lain')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseNote, setExpenseNote] = useState('')

  const journals = useMemo(() => buildJournals({
    transactions: store.transactions,
    cashMovements: store.cashMovements,
    stockMovements: store.stockMovements,
    expenses: store.expenses,
    hppOf: (transaction) => cogsForTransactions([transaction], store.menus, store.ingredients),
  }), [store])
  const profit = pnl(journals)
  const trial = trialBalance(journals)
  const sheet = balanceSheet(journals)

  const addExpense = () => {
    const amount = Number(expenseAmount)
    if (!Number.isFinite(amount) || amount <= 0) { notify('Isi nominal biaya'); return }
    const expense: Expense = { id: createId(), createdAt: new Date().toISOString(), category: expenseCategory, amount, note: expenseNote.trim() || expenseCategory }
    setStore((current) => ({
      ...current,
      expenses: [...current.expenses, expense],
      auditLog: [...current.auditLog, { id: createId(), createdAt: new Date().toISOString(), action: 'expense' as const, detail: `${expense.category} ${money(amount)}` }],
    }))
    setExpenseAmount('')
    setExpenseNote('')
    notify('Biaya operasional tersimpan')
  }

  return (
    <>
      <div className="owner-two-col">
        <section className="owner-panel">
          <h2>Laba rugi</h2>
          <p className="owner-muted">Diakui dari transaksi selesai, beban yang tercatat, dan penyesuaian opname persediaan.</p>
          <div className="owner-metric-list">
            <div><span>Penjualan</span><b>{money(profit.revenue)}</b></div>
            <div><span>Harga pokok penjualan</span><b>−{money(profit.cogs)}</b></div>
            <div className="strong"><span>Laba kotor</span><b>{money(profit.grossProfit)}</b></div>
            <div><span>Beban operasional</span><b>{profit.operatingExpenses >= 0 ? '−' : '+'}{money(Math.abs(profit.operatingExpenses))}</b></div>
            {profit.inventoryAdjustment !== 0 && (
              <div><span>Termasuk selisih persediaan</span><b>{profit.inventoryAdjustment >= 0 ? '−' : '+'}{money(Math.abs(profit.inventoryAdjustment))}</b></div>
            )}
            <div className="strong"><span>Laba bersih</span><b>{money(profit.netProfit)}</b></div>
          </div>
        </section>

        <section className="owner-panel">
          <h2>Neraca</h2>
          <p className="owner-muted">Aset = liabilitas + ekuitas: {Math.abs(sheet.totalAssets - (sheet.totalLiabilities + sheet.totalEquity)) < 1 ? 'seimbang' : 'periksa jurnal'}.</p>
          <div className="owner-metric-list">
            <div className="strong"><span>Aset</span><b>{money(sheet.totalAssets)}</b></div>
            <div className="strong"><span>Liabilitas</span><b>{money(sheet.totalLiabilities)}</b></div>
            <div className="strong"><span>Ekuitas</span><b>{money(sheet.totalEquity)}</b></div>
          </div>
        </section>
      </div>

      <section className="owner-panel">
        <div className="owner-panel-head">
          <div><h2>Catat biaya operasional</h2><p className="owner-muted">Beban langsung mengurangi laba dan kas.</p></div>
        </div>
        <div className="owner-form">
          <select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value as ExpenseCategory)} aria-label="Kategori biaya">{expenseCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <input type="number" min="0" placeholder="Nominal" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} />
          <input placeholder="Keterangan" value={expenseNote} onChange={(event) => setExpenseNote(event.target.value)} />
          <button className="owner-primary" onClick={addExpense}><Plus size={15} /> Simpan biaya</button>
        </div>
        {store.expenses.length === 0 ? <p className="owner-muted">Belum ada biaya tercatat.</p> : store.expenses.slice(-5).reverse().map((expense) => <div className="owner-row" key={expense.id}><span>{expense.category} • {expense.note}</span><b>{money(expense.amount)}</b></div>)}
      </section>

      <section className="owner-panel">
        <div className="owner-panel-head">
          <div><h2>Neraca saldo</h2><p className="owner-muted">{trial.balanced ? 'Seimbang' : 'Tidak seimbang'} • Debit {money(trial.debit)} • Kredit {money(trial.credit)}</p></div>
          <span className={trial.balanced ? 'owner-pill ok' : 'owner-pill danger'}>{trial.balanced ? 'BALANCE' : 'PERIKSA'}</span>
        </div>
      </section>
    </>
  )
}
