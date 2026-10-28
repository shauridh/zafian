export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) => row.map((cell) => {
      const text = String(cell ?? '')
      return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }).join(','))
    .join('\n')
}

export function downloadCsv(filename: string, rows: (string | number)[][]): boolean {
  if (typeof window === 'undefined') return false
  const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
  return true
}
