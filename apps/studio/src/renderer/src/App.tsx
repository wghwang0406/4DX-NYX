import { useCallback, useEffect, useMemo, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Player from './components/Player'
import ShotDetail from './components/ShotDetail'
import ShotPreview from './components/ShotPreview'
import SheetPreview from './components/SheetPreview'
import LayoutPreview from './components/LayoutPreview'
import Timeline from './components/Timeline'
import ChatPanel from './components/ChatPanel'
import ShotTable from './components/ShotTable'
import MdPendingBar from './components/MdPendingBar'
import VersionsBar from './components/VersionsBar'
import StartScreen from './views/StartScreen'
import SourceView from './views/SourceView'
import SettingsView from './views/SettingsView'
import AssetsView from './views/AssetsView'
import SheetViewer from './components/SheetViewer'
import PublishView from './views/PublishView'
import Onboarding from './views/Onboarding'
import type { UpdateInfo } from '../../shared/app-ipc'
import { ProjectProvider, useProject } from './state/project'
import { demoScenes, type Scene } from './data/sampleScene'
import { sequenceToScene } from './data/adapters'

export default function App() {
  const q = new URLSearchParams(window.location.search)
  const [onboard, setOnboard] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    if (!window.conti?.app) return
    // 검증 실행(test=1)은 안내를 띄우지 않는다 — onboarding=1 이면 강제로
    void window.conti.app.settings().then((s) => setOnboard(q.get('onboarding') === '1' || (!s.onboarded && q.get('test') !== '1')))
    return window.conti.onUpdate((u) => void window.conti.app.settings().then((s) => s.skipVersion !== u.version && setUpdate(u)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <ProjectProvider>
      {update && (
        <div className="fixed top-2 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-accent/60 bg-panel px-4 py-2 text-[12.5px] shadow-xl">
          <span>
            새 버전 <b>NYX {update.version}</b> 이 나왔습니다 (지금 {update.current}){update.notes ? ` — ${update.notes}` : ''}
          </span>
          <button onClick={() => void window.conti.app.openDownload(update.url)} className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white">
            내려받기
          </button>
          <button onClick={() => (void window.conti.app.setSettings({ skipVersion: update.version }), setUpdate(null))} className="text-[12px] text-muted hover:text-ink">
            나중에
          </button>
        </div>
      )}
      <Shell />
      {onboard && <Onboarding onDone={() => setOnboard(false)} />}
    </ProjectProvider>
  )
}

function Shell() {
  const { root, project, sequences, seq, setSeq, nav, setNav, close: closeProject } = useProject()
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

  const [playing, setPlaying] = useState(false)
  // Conti 왼쪽 위: 컷 상세(기본) / 원본 영상(영상 입력 시퀀스만). 애니매틱 재생은 Conti Export 로 옮겼다.
  const [contiTab, setContiTab] = useState<'detail' | 'video'>('detail')
  // Images 화면의 타임라인은 최종 이미지 단계 그림으로
  const imageScene = useMemo(() => (sequence && nav === 'Images' ? sequenceToScene(sequence, project?.title ?? '', 'image') : null), [sequence, nav, project])
  // Conti 시트 크게 보기·저장 (예전 Conti Export). ?lab=1 이면 Template Lab 으로 연다 (캡처용)
  const [sheetOpen, setSheetOpen] = useState(() => new URLSearchParams(window.location.search).get('lab') === '1')
  const videoTab = !!scene?.video && contiTab === 'video' && nav === 'Conti'

  useEffect(() => {
    setSelectedShot(null)
    setPlayhead(0)
    setPlaying(false)
    setContiTab('detail')
  }, [activeSeq])

  // 원본 영상 탭을 벗어나면 멈춘다
  useEffect(() => {
    if (!videoTab) setPlaying(false)
  }, [videoTab])

  const duration = scene?.duration ?? 0
  const playPause = useCallback(() => {
    setPlaying((v) => {
      if (!v && playhead >= duration - 0.05) setPlayhead(0)
      return !v
    })
  }, [playhead, duration])

  // Space = 원본 영상 재생/멈춤 (원본 영상 탭에서만, 입력란에서는 무시)
  useEffect(() => {
    if (!videoTab) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.code !== 'Space' || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return
      e.preventDefault()
      playPause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playPause, videoTab])

  // 프로젝트가 바뀌면 선택·설정 화면을 접는다
  useEffect(() => {
    setSelectedShot(null)
    setPlayhead(0)
    setPlaying(false)
    setShowDiag(false)
  }, [root])

  // 메뉴 막대: 설정… / 새 프로젝트… (프로젝트가 열려 있으면 닫고 시작 화면의 만들기 칸으로)
  useEffect(
    () =>
      window.conti?.onMenu((a) => {
        if (a === 'settings') setShowDiag(true)
        else {
          sessionStorage.setItem('nyx_new_project', '1')
          void closeProject()
        }
      }),
    [closeProject],
  )

  // 캡처·검증용: ?shot=0020 이면 그 컷을 선택한 채로 연다
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('shot')
    if (want && scene?.shots.some((x) => x.no === want) && !selectedShot) {
      setSelectedShot(want)
      const sh = scene.shots.find((x) => x.no === want)!
      setPlayhead(sh.tIn + 0.001)
    }
  }, [scene]) // eslint-disable-line react-hooks/exhaustive-deps

  // 컷을 고르면 플레이헤드도 그 컷으로 (재생 중이면 멈춤)
  const selectShot = useCallback(
    (no: string) => {
      setSelectedShot(no)
      setPlaying(false)
      const sh = scene?.shots.find((x) => x.no === no)
      if (sh) setPlayhead(sh.tIn + 0.001)
    },
    [scene],
  )

  // Conti 에서 아무 컷도 안 골랐으면 첫 컷을 고른다 (컷 상세가 비지 않게). 위의 씬 전환 초기화보다 뒤에 둔다.
  const firstShot = scene?.shots[0]?.no
  useEffect(() => {
    if ((nav === 'Conti' || nav === 'Shots' || nav === 'Images') && !selectedShot && firstShot) selectShot(firstShot)
  }, [nav, selectedShot, firstShot, selectShot])

  const changeDuration = useCallback(
    (shotId: string, sec: number) => {
      if (sequence) void window.conti.api.sequence.updateShot(sequence.seq, shotId, { durationSec: sec })
    },
    [sequence],
  )

  if (!root && !demoMode()) return <StartScreen />

  const workArea =
    nav === 'Shots' && sequence ? (
      // Shots = 콘티 확인: 목록(고른 행 아래 묘사 전체) + 고른 샷의 콘티 크게
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3 p-3 pt-0">
        <ShotTable sequence={sequence} selectedShot={selectedShot} onSelect={selectShot} />
        <ShotPreview sequence={sequence} selectedShot={selectedShot} stage="conti" />
      </div>
    ) : nav === 'Images' && sequence ? (
      // Images = 영상으로 넘어갈 최종 이미지: 목록 + 고른 샷의 이미지 크게 + 타임라인
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,1fr)] gap-3 p-3 pt-0">
        <div className="grid min-h-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
          <ShotTable sequence={sequence} selectedShot={selectedShot} onSelect={selectShot} stage="image" />
          <ShotPreview sequence={sequence} selectedShot={selectedShot} stage="image" />
        </div>
        {imageScene && <Timeline scene={imageScene} playhead={playhead} onSeek={setPlayhead} selectedShot={selectedShot} onSelect={selectShot} onDurationChange={changeDuration} />}
      </div>
    ) : nav === 'Conti' || nav === 'Shots' ? (
      <div className={`grid min-h-0 flex-1 gap-3 p-3 pt-0 ${sequence && selectedShot ? 'grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)_minmax(0,1fr)]'}`}>
        {nav === 'Shots' && sequence ? (
          <div className="grid min-h-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <ShotTable sequence={sequence} selectedShot={selectedShot} onSelect={selectShot} />
            <LayoutPreview seq={sequence.seq} mode="single" selectedShot={selectedShot} onSelect={selectShot} />
          </div>
        ) : (
          <div className="grid min-h-0 grid-cols-2 gap-3">
            <div className="flex min-h-0 flex-col gap-1.5">
              {scene?.video && (
                <div className="flex shrink-0 gap-1 text-[11.5px]" data-testid="conti-tabs">
                  {(
                    [
                      ['detail', '컷 상세'],
                      ['video', '원본 영상'],
                    ] as const
                  ).map(([k, label]) => (
                    <button key={k} onClick={() => setContiTab(k)} className={`rounded-md px-2.5 py-0.5 ${contiTab === k ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {videoTab ? (
                <Player scene={scene!} playhead={playhead} onSeek={setPlayhead} playing={playing} onPlayPause={playPause} onEnded={() => setPlaying(false)} sequence={sequence} />
              ) : (
                <ShotDetail scene={scene!} sequence={sequence} selectedShot={selectedShot} onSelect={selectShot} />
              )}
            </div>
            {sequence ? (
              <LayoutPreview
                seq={sequence.seq}
                mode="single"
                selectedShot={selectedShot}
                onSelect={selectShot}
                extra={
                  <button data-testid="sheet-open" onClick={() => setSheetOpen(true)} title="시트 전체를 크게 보고 저장" className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-muted hover:text-ink">
                    <Maximize2 size={11} /> 크게 보기·저장
                  </button>
                }
              />
            ) : (
              <SheetPreview scene={scene!} selectedShot={selectedShot} onSelect={selectShot} />
            )}
          </div>
        )}
        {sequence && selectedShot && <VersionsBar sequence={sequence} selectedShot={selectedShot} />}
        <Timeline scene={scene!} playhead={playhead} onSeek={setPlayhead} selectedShot={selectedShot} onSelect={selectShot} onDurationChange={sequence ? changeDuration : undefined} />
      </div>
    ) : nav === 'Publish' && sequence ? (
      <PublishView
        onGoShot={(no) => {
          setNav('Conti')
          setTimeout(() => selectShot(no), 0)
        }}
        onOpenSettings={() => setShowDiag(true)}
      />
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
        demo={demo}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <Header scene={scene} scenes={scenes} onSwitch={setSeq} projectTitle={project?.title ?? '데모'} />
        {!demo && <MdPendingBar />}
        {showDiag ? <SettingsView /> : nav === 'Sources' ? <SourceView /> : nav === 'Assets' && !demo ? <AssetsView /> : !scene ? <EmptyState /> : workArea}
        {sheetOpen && sequence && nav === 'Conti' && !showDiag && <SheetViewer seq={sequence.seq} selectedShot={selectedShot} onSelect={selectShot} onClose={() => setSheetOpen(false)} />}
      </main>

      {/* 프로젝트가 바뀌면 채팅 패널을 새로 (스레드는 프로젝트마다 따로 저장된다) */}
      <ChatPanel key={root ?? 'none'} scene={scene} selectedShot={selectedShot} demo={demo} />
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
        <div className="mt-1 text-[12px] text-muted">Sources 에서 시나리오나 영상을 가져오면 씬이 시퀀스로 만들어집니다.</div>
        <button onClick={() => setNav('Sources')} className="mt-4 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white">
          Sources 로 가기
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
