export type Category = {
  id: string
  name: string
}

export type MenuCategory = Category

export type IngredientCategory = Category

export type Ingredient = {
  id: string
  name: string
  /** Kategori bahan, dikelola terpisah dari kategori menu. */
  category: string
  unit: string
  costPerUnit: number
  purchaseUnit: string
  purchasePrice: number
  usagePerPurchaseUnit: number
  minStock: number
}

export type RecipeLine = {
  ingredientId: string
  qty: number
}

export type Menu = {
  id: string
  name: string
  category: string
  price: number
  emoji: string
  /** Path aset lokal, URL, atau data URL hasil unggahan. Ditampilkan utuh (tidak dipotong). */
  imageUrl?: string
  active: boolean
  recipe: RecipeLine[]
}

export const seedCategories: MenuCategory[] = [
  { id: 'paket', name: 'Paket' },
  { id: 'rice-bowl', name: 'Rice bowl' },
  { id: 'snack', name: 'Snack' },
  { id: 'saus', name: 'Saus' },
  { id: 'minuman', name: 'Minuman' },
]

const seedIngredientsBase: Omit<Ingredient, 'category'>[] = [
  { id: 'ayam-dada', name: 'Ayam dada marinasi', unit: 'potong', costPerUnit: 6000, purchaseUnit: 'ekor (9 potong)', purchasePrice: 48000, usagePerPurchaseUnit: 9, minStock: 18 },
  { id: 'ayam-paha-atas', name: 'Ayam paha atas marinasi', unit: 'potong', costPerUnit: 4500, purchaseUnit: 'ekor (9 potong)', purchasePrice: 48000, usagePerPurchaseUnit: 9, minStock: 18 },
  { id: 'ayam-paha-bawah', name: 'Ayam paha bawah marinasi', unit: 'potong', costPerUnit: 4500, purchaseUnit: 'ekor (9 potong)', purchasePrice: 48000, usagePerPurchaseUnit: 9, minStock: 18 },
  { id: 'ayam-sayap', name: 'Ayam sayap marinasi', unit: 'potong', costPerUnit: 4500, purchaseUnit: 'ekor (9 potong)', purchasePrice: 48000, usagePerPurchaseUnit: 9, minStock: 18 },
  { id: 'ayam-ricebowl', name: 'Ayam potong rice bowl', unit: 'potong', costPerUnit: 5845, purchaseUnit: 'ekor (9 potong)', purchasePrice: 48000, usagePerPurchaseUnit: 9, minStock: 18 },
  { id: 'tepung-bumbu', name: 'Tepung bumbu', unit: 'gram', costPerUnit: 23.5, purchaseUnit: 'pack 1 kg', purchasePrice: 23500, usagePerPurchaseUnit: 1000, minStock: 2000 },
  { id: 'saus-sachet', name: 'Saus sambal sachet', unit: 'sachet', costPerUnit: 180, purchaseUnit: 'pack 125 sachet', purchasePrice: 22500, usagePerPurchaseUnit: 125, minStock: 250 },
  { id: 'minyak', name: 'Minyak goreng', unit: 'ml', costPerUnit: 21.7, purchaseUnit: 'pouch 2 liter', purchasePrice: 43400, usagePerPurchaseUnit: 2000, minStock: 4000 },
  { id: 'plastik', name: 'Kantong plastik', unit: 'lembar', costPerUnit: 140, purchaseUnit: 'pack 50 lembar', purchasePrice: 7000, usagePerPurchaseUnit: 50, minStock: 100 },
  { id: 'gas', name: 'Gas 3 kg (alokasi)', unit: 'porsi', costPerUnit: 128, purchaseUnit: 'tabung 3 kg', purchasePrice: 23000, usagePerPurchaseUnit: 180, minStock: 45 },
  { id: 'beras', name: 'Beras mentik wangi', unit: 'gram', costPerUnit: 12.55, purchaseUnit: 'karung 25 kg', purchasePrice: 313750, usagePerPurchaseUnit: 25000, minStock: 5000 },
  { id: 'kertas-nasi', name: 'Kertas nasi', unit: 'lembar', costPerUnit: 130, purchaseUnit: 'pack 100', purchasePrice: 13000, usagePerPurchaseUnit: 100, minStock: 200 },
  { id: 'box', name: 'Box nasi', unit: 'pcs', costPerUnit: 1250, purchaseUnit: 'pack 100', purchasePrice: 125000, usagePerPurchaseUnit: 100, minStock: 200 },
  { id: 'paper-bowl-650', name: 'Paper bowl 650 ml', unit: 'pcs', costPerUnit: 1650, purchaseUnit: 'pack 100', purchasePrice: 165000, usagePerPurchaseUnit: 100, minStock: 200 },
  { id: 'sendok', name: 'Sendok plastik', unit: 'pcs', costPerUnit: 240, purchaseUnit: 'pack 50', purchasePrice: 12000, usagePerPurchaseUnit: 50, minStock: 100 },
  { id: 'timun', name: 'Timun', unit: 'slice', costPerUnit: 187, purchaseUnit: 'kg', purchasePrice: 8000, usagePerPurchaseUnit: 43, minStock: 86 },
  { id: 'sambal-geprek', name: 'Sambal geprek', unit: 'ml', costPerUnit: 85.7, purchaseUnit: 'pack 500 gram', purchasePrice: 64000, usagePerPurchaseUnit: 750, minStock: 750 },
  { id: 'saus-bbq', name: 'Saus BBQ', unit: 'sachet', costPerUnit: 800, purchaseUnit: 'sachet 20 gram', purchasePrice: 800, usagePerPurchaseUnit: 1, minStock: 20 },
  { id: 'saus-mentai', name: 'Saus keju mentai', unit: 'gram', costPerUnit: 2.16, purchaseUnit: 'pack 500 gram', purchasePrice: 27000, usagePerPurchaseUnit: 500, minStock: 1000 },
  { id: 'kentang', name: 'Kentang simplot', unit: 'gram', costPerUnit: 42.3, purchaseUnit: 'pack 2,72 kg', purchasePrice: 115000, usagePerPurchaseUnit: 2720, minStock: 2720 },
  { id: 'box-kentang', name: 'Box kentang', unit: 'pcs', costPerUnit: 599, purchaseUnit: 'pack 200', purchasePrice: 119800, usagePerPurchaseUnit: 200, minStock: 200 },
  { id: 'chicken-roll', name: 'Chicken roll', unit: 'pcs', costPerUnit: 2440, purchaseUnit: 'pack 10 pcs', purchasePrice: 24400, usagePerPurchaseUnit: 10, minStock: 20 },
  { id: 'bakso', name: 'Bakso', unit: 'pcs', costPerUnit: 2400, purchaseUnit: 'pack 50 pcs', purchasePrice: 24000, usagePerPurchaseUnit: 50, minStock: 100 },
]

const seedIngredientCategoryById: Record<string, string> = {
  'ayam-dada': 'Protein',
  'ayam-paha-atas': 'Protein',
  'ayam-paha-bawah': 'Protein',
  'ayam-sayap': 'Protein',
  'ayam-ricebowl': 'Protein',
  'chicken-roll': 'Protein',
  bakso: 'Protein',
  'tepung-bumbu': 'Bumbu & saus',
  'saus-sachet': 'Bumbu & saus',
  minyak: 'Bumbu & saus',
  'sambal-geprek': 'Bumbu & saus',
  'saus-bbq': 'Bumbu & saus',
  'saus-mentai': 'Bumbu & saus',
  beras: 'Bahan pokok',
  timun: 'Sayur',
  kentang: 'Sayur',
  plastik: 'Kemasan',
  'kertas-nasi': 'Kemasan',
  box: 'Kemasan',
  'paper-bowl-650': 'Kemasan',
  sendok: 'Kemasan',
  'box-kentang': 'Kemasan',
  gas: 'Operasional',
}

export const seedIngredients: Ingredient[] = seedIngredientsBase.map((ingredient) => ({
  id: ingredient.id,
  name: ingredient.name,
  category: seedIngredientCategoryById[ingredient.id] ?? 'Lainnya',
  unit: ingredient.unit,
  costPerUnit: ingredient.costPerUnit,
  purchaseUnit: ingredient.purchaseUnit,
  purchasePrice: ingredient.purchasePrice,
  usagePerPurchaseUnit: ingredient.usagePerPurchaseUnit,
  minStock: ingredient.minStock,
}))

export const seedIngredientCategories: IngredientCategory[] = [
  { id: 'protein', name: 'Protein' },
  { id: 'bahan-pokok', name: 'Bahan pokok' },
  { id: 'bumbu-saus', name: 'Bumbu & saus' },
  { id: 'sayur', name: 'Sayur' },
  { id: 'kemasan', name: 'Kemasan' },
  { id: 'operasional', name: 'Operasional' },
  { id: 'lainnya', name: 'Lainnya' },
]

export const seedMenus: Menu[] = [
  {
    id: 'dada', name: 'Ayam Dada + Nasi', category: 'Paket', price: 16000, emoji: '🍗', imageUrl: '/menu/paket-dada.svg', active: true,
    recipe: [
      { ingredientId: 'ayam-dada', qty: 1 }, { ingredientId: 'tepung-bumbu', qty: 50 }, { ingredientId: 'saus-sachet', qty: 1 },
      { ingredientId: 'minyak', qty: 31 }, { ingredientId: 'plastik', qty: 2 }, { ingredientId: 'gas', qty: 1 },
      { ingredientId: 'beras', qty: 110 }, { ingredientId: 'kertas-nasi', qty: 1 }, { ingredientId: 'box', qty: 1 },
    ],
  },
  {
    id: 'paha', name: 'Ayam Paha + Nasi', category: 'Paket', price: 14000, emoji: '🍗', imageUrl: '/menu/paket-paha.svg', active: true,
    recipe: [
      { ingredientId: 'ayam-paha-bawah', qty: 1 }, { ingredientId: 'tepung-bumbu', qty: 37.5 }, { ingredientId: 'saus-sachet', qty: 1 },
      { ingredientId: 'minyak', qty: 23.5 }, { ingredientId: 'plastik', qty: 2 }, { ingredientId: 'gas', qty: 1 },
      { ingredientId: 'beras', qty: 110 }, { ingredientId: 'kertas-nasi', qty: 1 }, { ingredientId: 'box', qty: 1 },
    ],
  },
  {
    id: 'sayap', name: 'Ayam Sayap + Nasi', category: 'Paket', price: 13000, emoji: '🍗', imageUrl: '/menu/paket-sayap.svg', active: true,
    recipe: [
      { ingredientId: 'ayam-sayap', qty: 1 }, { ingredientId: 'tepung-bumbu', qty: 37.5 }, { ingredientId: 'saus-sachet', qty: 1 },
      { ingredientId: 'minyak', qty: 23.5 }, { ingredientId: 'plastik', qty: 2 }, { ingredientId: 'gas', qty: 1 },
      { ingredientId: 'beras', qty: 110 }, { ingredientId: 'kertas-nasi', qty: 1 }, { ingredientId: 'box', qty: 1 },
    ],
  },
  {
    id: 'geprek', name: 'Rice Bowl Geprek 650', category: 'Rice bowl', price: 15000, emoji: '🍚', imageUrl: '/menu/ricebowl-geprek.svg', active: true,
    recipe: [
      { ingredientId: 'ayam-ricebowl', qty: 1 }, { ingredientId: 'beras', qty: 120 }, { ingredientId: 'sambal-geprek', qty: 30 },
      { ingredientId: 'sendok', qty: 1 }, { ingredientId: 'plastik', qty: 1 }, { ingredientId: 'paper-bowl-650', qty: 1 }, { ingredientId: 'timun', qty: 2 },
    ],
  },
  {
    id: 'bbq', name: 'Rice Bowl BBQ 650', category: 'Rice bowl', price: 15000, emoji: '🥣', imageUrl: '/menu/ricebowl-bbq.svg', active: true,
    recipe: [
      { ingredientId: 'ayam-ricebowl', qty: 1 }, { ingredientId: 'beras', qty: 120 }, { ingredientId: 'saus-bbq', qty: 2 },
      { ingredientId: 'saus-sachet', qty: 2 }, { ingredientId: 'sendok', qty: 1 }, { ingredientId: 'plastik', qty: 1 },
      { ingredientId: 'paper-bowl-650', qty: 1 }, { ingredientId: 'timun', qty: 2 },
    ],
  },
  {
    id: 'katsu', name: 'Rice Bowl Katsu 650', category: 'Rice bowl', price: 15000, emoji: '🍱', imageUrl: '/menu/ricebowl-katsu.svg', active: true,
    recipe: [
      { ingredientId: 'ayam-ricebowl', qty: 1 }, { ingredientId: 'beras', qty: 135 }, { ingredientId: 'saus-mentai', qty: 430 },
      { ingredientId: 'saus-sachet', qty: 1 }, { ingredientId: 'timun', qty: 2 }, { ingredientId: 'sendok', qty: 1 },
      { ingredientId: 'plastik', qty: 1 }, { ingredientId: 'paper-bowl-650', qty: 1 },
    ],
  },
  {
    id: 'roll', name: 'Chicken Roll', category: 'Snack', price: 5000, emoji: '🌯', imageUrl: '/menu/snack-roll.svg', active: true,
    recipe: [
      { ingredientId: 'chicken-roll', qty: 1 }, { ingredientId: 'minyak', qty: 33 }, { ingredientId: 'plastik', qty: 1 },
      { ingredientId: 'saus-sachet', qty: 1 }, { ingredientId: 'gas', qty: 1 },
    ],
  },
  {
    id: 'bakso', name: 'Bakso Tusuk', category: 'Snack', price: 5000, emoji: '🍢', imageUrl: '/menu/snack-bakso.svg', active: true,
    recipe: [
      { ingredientId: 'bakso', qty: 1 }, { ingredientId: 'minyak', qty: 33 }, { ingredientId: 'plastik', qty: 1 },
      { ingredientId: 'saus-sachet', qty: 1 }, { ingredientId: 'gas', qty: 1 },
    ],
  },
  {
    id: 'kentang', name: 'Kentang', category: 'Snack', price: 8000, emoji: '🍟', imageUrl: '/menu/snack-kentang.svg', active: true,
    recipe: [
      { ingredientId: 'kentang', qty: 120 }, { ingredientId: 'minyak', qty: 26 }, { ingredientId: 'box-kentang', qty: 1 },
      { ingredientId: 'saus-sachet', qty: 2 }, { ingredientId: 'plastik', qty: 1 }, { ingredientId: 'gas', qty: 1 },
    ],
  },
  {
    id: 'mentai', name: 'Saus Mentai', category: 'Saus', price: 3000, emoji: '🫙', imageUrl: '/menu/saus-mentai.svg', active: true,
    recipe: [{ ingredientId: 'saus-mentai', qty: 60 }],
  },
  {
    id: 'sambal', name: 'Sambal Geprek', category: 'Saus', price: 5000, emoji: '🌶️', imageUrl: '/menu/saus-geprek.svg', active: true,
    recipe: [{ ingredientId: 'sambal-geprek', qty: 35 }, { ingredientId: 'minyak', qty: 12 }],
  },
]

/** Harga pokok penjualan per porsi dari resep. */
export function menuHpp(menu: Menu, ingredients: Ingredient[]): number {
  return menu.recipe.reduce((sum, line) => {
    const ingredient = ingredients.find((item) => item.id === line.ingredientId)
    return sum + (ingredient ? ingredient.costPerUnit * line.qty : 0)
  }, 0)
}

export function menuMargin(menu: Menu, ingredients: Ingredient[]): { hpp: number; margin: number; marginPct: number } {
  const hpp = menuHpp(menu, ingredients)
  const margin = menu.price - hpp
  const marginPct = menu.price > 0 ? (margin / menu.price) * 100 : 0
  return { hpp, margin, marginPct }
}

/** Kategori menu yang benar-benar dipakai, urut sesuai daftar kategori. */
export function menuCategories(menus: Menu[], categories: MenuCategory[]): MenuCategory[] {
  const used = new Set(menus.filter((menu) => menu.active).map((menu) => menu.category))
  return categories.filter((category) => used.has(category.name))
}

/** Biaya per satuan pemakaian, berguna saat harga beli berubah. */
export function costPerUsageUnit(ingredient: Ingredient): number {
  return ingredient.usagePerPurchaseUnit > 0 ? ingredient.purchasePrice / ingredient.usagePerPurchaseUnit : ingredient.costPerUnit
}
