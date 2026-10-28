import type { Dispatch, SetStateAction } from 'react'

import type { PosStore } from '../../domain/pos'

export type OwnerTab = 'ringkasan' | 'menu' | 'kategori' | 'stok' | 'forecast' | 'laporan' | 'pengaturan' | 'backup'

export type OwnerTabProps = {
  store: PosStore
  setStore: Dispatch<SetStateAction<PosStore>>
  notify: (message: string) => void
  goTab: (tab: OwnerTab) => void
}
