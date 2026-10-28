import { cogsForTransactions } from './inventory'
import type { PosStore, Transaction } from './pos'

const DAY_MS = 24 * 60 * 60 * 1000

export type SummaryPeriod = 'today' | '7d' | '30d' | 'month' | 'custom'

export type PeriodRange = {
  preset: SummaryPeriod
  start: Date
  end: Date
  label: string
  days: number
}

export type TrendPoint = {
  key: string
  label: string
  detail: string
  revenue: number
  transactions: number
}

export type PaymentSlice = {
  key: 'cash' | 'qris' | 'unpaid'
  label: string
  value: number
  share: number
}

export type ChannelRow = {
  key: string
  label: string
  revenue: number
  transactions: number
  share: number
}

export type CategoryRow = {
  key: string
  label: string
  revenue: number
  items: number
  share: number
}

export type HourPoint = {
  hour: number
  label: string
  revenue: number
  transactions: number
}

export type OverviewMetrics = {
  revenue: number
  received: number
  cashReceived: number
  qrisReceived: number
  unpaid: number
  transactions: number
  items: number
  averageTicket: number
  averageDailyRevenue: number
  cogs: number
  grossProfit: number
  grossMargin: number
  expenses: number
  expenseCount: number
  inventoryAdjustment: number
  netProfit: number
  previousRevenue: number
  previousTransactions: number
  revenueDelta: number | null
  transactionDelta: number | null
}

export type OverviewSummary = {
  range: PeriodRange
  previous: PeriodRange
  metrics: OverviewMetrics
  trend: TrendPoint[]
  payments: PaymentSlice[]
  channels: ChannelRow[]
  categories: CategoryRow[]
  hours: HourPoint[]
  peakHour: HourPoint | null
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function parseLocalDate(value: string | undefined): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
}

function compactDate(date: Date): string {
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
}

function rangeLabel(start: Date, end: Date): string {
  if (start.toDateString() === end.toDateString()) return shortDate(start)
  return `${compactDate(start)} – ${shortDate(end)}`
}

function withRange(preset: SummaryPeriod, start: Date, end: Date): PeriodRange {
  const rangeStart = startOfDay(start)
  const rangeEnd = endOfDay(end)
  const days = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS))
  return { preset, start: rangeStart, end: rangeEnd, label: rangeLabel(rangeStart, rangeEnd), days }
}

function previousRange(range: PeriodRange): PeriodRange {
  const duration = range.end.getTime() - range.start.getTime() + 1
  const end = new Date(range.start.getTime() - 1)
  const start = new Date(end.getTime() - duration + 1)
  return { ...range, start, end, label: rangeLabel(start, end) }
}

/** Rentang lokal (bukan UTC) agar transaksi dekat tengah malam tidak masuk hari yang salah. */
export function resolvePeriod(preset: SummaryPeriod, now = new Date(), customStart?: string, customEnd?: string): PeriodRange {
  const today = startOfDay(now)
  if (preset === 'today') return withRange('today', today, today)
  if (preset === '7d') return withRange('7d', addDays(today, -6), today)
  if (preset === '30d') return withRange('30d', addDays(today, -29), today)
  if (preset === 'month') return withRange('month', new Date(today.getFullYear(), today.getMonth(), 1), today)

  const parsedStart = parseLocalDate(customStart)
  const parsedEnd = parseLocalDate(customEnd)
  if (!parsedStart || !parsedEnd) return withRange('7d', addDays(today, -6), today)
  return parsedStart.getTime() <= parsedEnd.getTime()
    ? withRange('custom', parsedStart, parsedEnd)
    : withRange('custom', parsedEnd, parsedStart)
}

export function dateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

function inRange(iso: string, range: PeriodRange): boolean {
  const time = new Date(iso).getTime()
  return Number.isFinite(time) && time >= range.start.getTime() && time <= range.end.getTime()
}

function completedWithin(transactions: Transaction[], range: PeriodRange): Transaction[] {
  return transactions.filter((transaction) => transaction.status === 'completed' && inRange(transaction.createdAt, range))
}

function netReceived(transaction: Transaction): number {
  return Math.max(0, Math.min(transaction.subtotal, transaction.paidAmount - transaction.change))
}

function buildTrend(transactions: Transaction[], range: PeriodRange): TrendPoint[] {
  if (range.days <= 1) {
    const hours = Array.from({ length: 24 }, (_, hour) => {
      const label = `${String(hour).padStart(2, '0')}:00`
      return { key: `h-${hour}`, label, detail: label, revenue: 0, transactions: 0 }
    })
    for (const transaction of transactions) {
      const hour = new Date(transaction.createdAt).getHours()
      if (!Number.isFinite(hour)) continue
      hours[hour].revenue += transaction.subtotal
      hours[hour].transactions += 1
    }
    return hours
  }

  if (range.days <= 45) {
    const days: TrendPoint[] = []
    for (let index = 0; index < range.days; index += 1) {
      const date = addDays(range.start, index)
      days.push({
        key: `d-${dateInputValue(date)}`,
        label: date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
        detail: shortDate(date),
        revenue: 0,
        transactions: 0,
      })
    }
    for (const transaction of transactions) {
      const date = new Date(transaction.createdAt)
      const key = `d-${dateInputValue(date)}`
      const bucket = days.find((point) => point.key === key)
      if (!bucket) continue
      bucket.revenue += transaction.subtotal
      bucket.transactions += 1
    }
    return days
  }

  const weeks: TrendPoint[] = []
  for (let start = 0; start < range.days; start += 7) {
    const date = addDays(range.start, start)
    const end = addDays(date, 6)
    weeks.push({
      key: `w-${dateInputValue(date)}`,
      label: compactDate(date),
      detail: `${compactDate(date)} – ${compactDate(end.getTime() > range.end.getTime() ? range.end : end)}`,
      revenue: 0,
      transactions: 0,
    })
  }
  for (const transaction of transactions) {
    const index = Math.floor((new Date(transaction.createdAt).getTime() - range.start.getTime()) / (DAY_MS * 7))
    const bucket = weeks[Math.max(0, Math.min(weeks.length - 1, index))]
    if (!bucket) continue
    bucket.revenue += transaction.subtotal
    bucket.transactions += 1
  }
  return weeks
}

function buildPayments(transactions: Transaction[], revenue: number): PaymentSlice[] {
  let cash = 0
  let qris = 0
  for (const transaction of transactions) {
    const received = netReceived(transaction)
    if (transaction.paymentMethod === 'Cash') cash += received
    if (transaction.paymentMethod === 'QRIS') qris += received
  }
  const unpaid = Math.max(0, revenue - cash - qris)
  const share = (value: number) => revenue > 0 ? (value / revenue) * 100 : 0
  return [
    { key: 'cash', label: 'Cash', value: cash, share: share(cash) },
    { key: 'qris', label: 'QRIS', value: qris, share: share(qris) },
    { key: 'unpaid', label: 'Belum terbayar', value: unpaid, share: share(unpaid) },
  ]
}

function buildChannels(transactions: Transaction[], revenue: number): ChannelRow[] {
  const totals = new Map<string, { revenue: number; transactions: number }>()
  for (const transaction of transactions) {
    const current = totals.get(transaction.orderType) ?? { revenue: 0, transactions: 0 }
    current.revenue += transaction.subtotal
    current.transactions += 1
    totals.set(transaction.orderType, current)
  }
  return [...totals.entries()]
    .map(([key, value]) => ({
      key,
      label: key,
      revenue: value.revenue,
      transactions: value.transactions,
      share: revenue > 0 ? (value.revenue / revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

function buildCategories(transactions: Transaction[], revenue: number): CategoryRow[] {
  const totals = new Map<string, { revenue: number; items: number }>()
  for (const transaction of transactions) {
    for (const item of transaction.items) {
      const current = totals.get(item.category) ?? { revenue: 0, items: 0 }
      current.revenue += item.price * item.qty
      current.items += item.qty
      totals.set(item.category, current)
    }
  }
  return [...totals.entries()]
    .map(([key, value]) => ({
      key,
      label: key,
      revenue: value.revenue,
      items: value.items,
      share: revenue > 0 ? (value.revenue / revenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

function buildHours(transactions: Transaction[]): HourPoint[] {
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    revenue: 0,
    transactions: 0,
  }))
  for (const transaction of transactions) {
    const hour = new Date(transaction.createdAt).getHours()
    if (!Number.isFinite(hour)) continue
    hours[hour].revenue += transaction.subtotal
    hours[hour].transactions += 1
  }
  return hours
}

function inventoryAdjustmentFor(store: PosStore, range: PeriodRange): number {
  return store.stockMovements
    .filter((movement) => movement.type === 'opname' && inRange(movement.createdAt, range) && movement.qty !== 0)
    .reduce((sum, movement) => {
      const value = Math.abs(movement.qty) * (movement.unitCost ?? 0)
      // Kekurangan stok menambah beban; surplus mengurangi beban.
      return sum + (movement.qty < 0 ? value : -value)
    }, 0)
}

export function buildOverviewSummary(store: PosStore, range: PeriodRange): OverviewSummary {
  const previous = previousRange(range)
  const transactions = completedWithin(store.transactions, range)
  const previousTransactions = completedWithin(store.transactions, previous)

  const revenue = transactions.reduce((sum, transaction) => sum + transaction.subtotal, 0)
  const previousRevenue = previousTransactions.reduce((sum, transaction) => sum + transaction.subtotal, 0)
  const items = transactions.reduce((sum, transaction) => sum + transaction.items.reduce((count, item) => count + item.qty, 0), 0)
  const cogs = cogsForTransactions(transactions, store.menus, store.ingredients)
  const grossProfit = revenue - cogs
  const expensesInRange = store.expenses.filter((expense) => inRange(expense.createdAt, range))
  const expenses = expensesInRange.reduce((sum, expense) => sum + expense.amount, 0)
  const inventoryAdjustment = inventoryAdjustmentFor(store, range)
  const payments = buildPayments(transactions, revenue)
  const cashReceived = payments.find((slice) => slice.key === 'cash')?.value ?? 0
  const qrisReceived = payments.find((slice) => slice.key === 'qris')?.value ?? 0
  const received = cashReceived + qrisReceived
  const hours = buildHours(transactions)
  const peakHour = hours.reduce<HourPoint | null>((best, point) => {
    if (point.transactions === 0) return best
    if (!best) return point
    if (point.transactions !== best.transactions) return point.transactions > best.transactions ? point : best
    return point.revenue > best.revenue ? point : best
  }, null)

  return {
    range,
    previous,
    metrics: {
      revenue,
      received,
      cashReceived,
      qrisReceived,
      unpaid: Math.max(0, revenue - received),
      transactions: transactions.length,
      items,
      averageTicket: transactions.length > 0 ? revenue / transactions.length : 0,
      averageDailyRevenue: revenue / range.days,
      cogs,
      grossProfit,
      grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      expenses,
      expenseCount: expensesInRange.length,
      inventoryAdjustment,
      netProfit: grossProfit - expenses - inventoryAdjustment,
      previousRevenue,
      previousTransactions: previousTransactions.length,
      revenueDelta: percentDelta(revenue, previousRevenue),
      transactionDelta: percentDelta(transactions.length, previousTransactions.length),
    },
    trend: buildTrend(transactions, range),
    payments,
    channels: buildChannels(transactions, revenue),
    categories: buildCategories(transactions, revenue),
    hours,
    peakHour,
  }
}
