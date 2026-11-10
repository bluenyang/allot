import { ref } from 'vue'
import { deleteItem, saveItem, type ListKey, type State } from './store'

/**
 * Editing state for one list: open a copy, save it through the API, delete it.
 * The copy is edited, never the stored item, so "취소" leaves the data alone.
 */
export function useEditor<K extends ListKey>(key: K, blank: () => State[K][number], validate?: (x: State[K][number]) => string | null) {
  type Item = State[K][number]
  const item = ref<Item | null>(null)
  const error = ref('')
  const busy = ref(false)

  function open(x?: Item) {
    item.value = x ? (JSON.parse(JSON.stringify(x)) as Item) : blank()
    error.value = ''
  }
  function close() {
    item.value = null
    error.value = ''
  }
  async function run(fn: () => Promise<unknown>) {
    busy.value = true
    try {
      await fn()
      close()
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      busy.value = false
    }
  }
  async function save() {
    const x = item.value
    if (!x) return
    const problem = validate?.(x)
    if (problem) return (error.value = problem)
    await run(() => saveItem(key, x))
  }
  async function remove() {
    const x = item.value as { id: string } | null
    if (x?.id) await run(() => deleteItem(key, x.id))
  }
  return { item, error, busy, open, close, save, remove }
}
