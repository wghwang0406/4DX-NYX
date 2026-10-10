import { useEffect, useState } from 'react'
import { FileWarning, Check, Undo2 } from 'lucide-react'
import type { PendingChangeView } from '../../../shared/ipc'

/** md 파일이 밖에서 바뀌었을 때 상단에 뜨는 띠. 조용히 합치지 않고 사용자가 고른다. */
export default function MdPendingBar() {
  const [list, setList] = useState<PendingChangeView[]>([])
  const [open, setOpen] = useState(false)

  async function load() {
    setList(await window.conti.api.md.pending())
  }
  useEffect(() => {
    void load()
    return window.conti.onStoreChange((c) => {
      if (c.type === 'md-pending') void load()
    })
  }, [])

  if (!list.length) return null
  return (
    <div className="mx-3 mb-2 rounded-md border border-warn/50 bg-warn/10 text-[12px]">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left">
        <FileWarning size={14} className="text-warn" />
        <span>
          md 파일 {list.length}개가 앱 밖에서 수정됐습니다. {open ? '접기' : '내용 보기'}
        </span>
      </button>
      {open && (
        <div className="border-t border-warn/30 px-3 py-2">
          {list.map((c) => (
            <div key={c.rel} className="mb-2 flex items-start justify-between gap-3 last:mb-0">
              <div>
                <div className="font-mono text-[11px] text-muted">{c.rel}</div>
                <ul className="mt-0.5 list-disc pl-4">
                  {c.summary.slice(0, 8).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                  {c.summary.length > 8 && <li className="text-muted">… 외 {c.summary.length - 8}건</li>}
                </ul>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button onClick={() => void window.conti.api.md.accept(c.rel).then(load)} className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-white">
                  <Check size={12} /> 반영
                </button>
                <button onClick={() => void window.conti.api.md.discard(c.rel).then(load)} className="flex items-center gap-1 rounded border border-line px-2 py-1 hover:bg-panel-2">
                  <Undo2 size={12} /> 되돌리기
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
