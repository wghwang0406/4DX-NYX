import { useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Player from './components/Player'
import SheetPreview from './components/SheetPreview'
import Timeline from './components/Timeline'
import ChatPanel from './components/ChatPanel'
import ShotTable from './components/ShotTable'
import MdPendingBar from './components/MdPendingBar'
import VersionsBar from './components/VersionsBar'
import StartScreen from './views/StartScreen'
import SourceView from './views/SourceView'
import SettingsView from './views/SettingsView'
import AssetsView from './views/AssetsView'
import { ProjectProvider, useProject } from './state/project'
import { demoScenes, type Scene } from './data/sampleScene'
import { sequenceToScene } from './data/adapters'

export default function App() {
  return (
    <ProjectProvider>
      <Shell />
    </ProjectProvider>
  )
}

function Shell() {
  const { root, project, sequences, seq, setSeq, nav, setNav } = useProject()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedShot, setSelectedShot] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [showDiag, setShowDiag] = useState(() => new URLSearchParams(window.location.search).get('nav') === '설정')

  const demo = !root
  const scenes: Scene[] = useMemo(
    () => (demo ? demoScenes : sequences.map((s) => sequenceToScene(s, project?.title ?? ''))),
    [demo, sequences, project],
  )
  const activeSeq = demo ? demoScenes[0].seq : seq
  const scene = scenes.find((s) => s.seq === activeSeq) ?? scenes[0] ?? null
  const sequence = sequences.find((s) => s.seq === scene?.seq) ?? null

  useEffect(() => {
    setSelectedShot(null)
    setPlayhead(0)
  }, [activeSeq])

  if (!root && !demoMode()) return <StartScreen />

  const workArea =
    nav === '콘티' || nav === '샷 분해' ? (
      <div className={`grid min-h-0 flex-1 gap-3 p-3 pt-0 ${sequence && selectedShot ? 'grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
        {nav === '샷 분해' && sequence ? (
          <div className="grid min-h-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <ShotTable sequence={sequence} selectedShot={selectedShot} onSelect={setSelectedShot} />
            <SheetPreview scene={scene!} selectedShot={selectedShot} onSelect={setSelectedShot} />
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-2 gap-3">
            <Player scene={scene!} playhead={playhead} onSeek={setPlayhead} />
            <SheetPreview scene={scene!} selectedShot={selectedShot} onSelect={setSelectedShot} />
          </div>
        )}
        {sequence && selectedShot && <VersionsBar sequence={sequence} selectedShot={selectedShot} />}
        <Timeline scene={scene!} playhead={playhead} onSeek={setPlayhead} selectedShot={selectedShot} onSelect={setSelectedShot} />
      </div>
    ) : (
      <ComingSoon nav={nav} />
    )

  return (
    <div className="flex h-full">
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        projectTitle={project?.title ?? '데모'}
        scenes={scenes}
        activeSeq={scene?.seq ?? ''}
        onSelectScene={setSeq}
        nav={nav}
        onSelectNav={(n) => {
          setShowDiag(false)
          setNav(n)
        }}
        onDiagnostics={() => setShowDiag(true)}
        diagActive={showDiag}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <Header scene={scene} scenes={scenes} onSwitch={setSeq} projectTitle={project?.title ?? '데모'} />
        {!demo && <MdPendingBar />}
        {showDiag ? <SettingsView /> : nav === '소스' ? <SourceView /> : nav === '에셋' && !demo ? <AssetsView /> : !scene ? <EmptyState /> : workArea}
      </main>

      <ChatPanel scene={scene} selectedShot={selectedShot} demo={demo} />
    </div>
  )
}

// 개발 중 StartScreen 을 건너뛰고 데모 데이터를 보려면 ?demo=1
function demoMode(): boolean {
  return new URLSearchParams(window.location.search).get('demo') === '1'
}

function EmptyState() {
  const { setNav } = useProject()
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="rounded-lg border border-dashed border-line p-8 text-center">
        <div className="text-[14px] font-medium">아직 시퀀스가 없습니다</div>
        <div className="mt-1 text-[12px] text-muted">소스에서 시나리오를 가져오면 씬이 시퀀스로 만들어집니다.</div>
        <button onClick={() => setNav('소스')} className="mt-4 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white">
          소스로 가기
        </button>
      </div>
    </div>
  )
}

function ComingSoon({ nav }: { nav: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="rounded-lg border border-dashed border-line px-8 py-6 text-center">
        <div className="text-[14px] font-medium">{nav}</div>
        <div className="mt-1 text-[12px] text-muted">다음 마일스톤에서 붙습니다.</div>
      </div>
    </div>
  )
}
