import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, LogIn, RefreshCw, ArrowRight, ArrowLeft, Copy, Loader2 } from 'lucide-react'
import type { AccountStatus, AuthTool } from '../../../shared/auth-ipc'
import type { ToolStatus } from '../../../shared/ipc'
import { ServerSettings } from './SettingsView'

const STEPS = ['환영', 'AI 계정', '도구', '게시 서버', '시작'] as const

/** 첫 실행 안내 — 로그인·도구·게시 서버를 한 번에 점검한다. 언제든 설정에서 다시 할 수 있다. */
export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null)
  const [tools, setTools] = useState<ToolStatus[] | null>(null)
  const [busy, setBusy] = useState<AuthTool | null>(null)

  const loadAccounts = () => void window.conti.auth.status().then(setAccounts)
  const loadTools = () => void window.conti.api.diag.tools().then(setTools)
  useEffect(() => {
    loadAccounts()
    loadTools()
    return window.conti.onAuthEvent((e) => {
      if (e.t === 'done' || e.t === 'error' || e.t === 'logged_out') {
        setBusy(null)
        loadAccounts()
      }
    })
  }, [])

  const ai = accounts?.filter((a) => a.tool !== 'higgsfield') ?? []
  const aiOk = ai.some((a) => a.loggedIn)
  const ffmpeg = tools?.find((t) => t.name === 'ffmpeg')

  async function finish() {
    await window.conti.app.setSettings({ onboarded: true, onboardedAt: Date.now() })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-full w-[640px] flex-col rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex items-center gap-1.5 text-[11.5px] ${i === step ? 'text-ink' : i < step ? 'text-emerald-400' : 'text-muted'}`}>
              <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${i === step ? 'bg-accent text-white' : i < step ? 'bg-emerald-500 text-black' : 'bg-line'}`}>{i < step ? '✓' : i + 1}</span>
              {s}
              {i < STEPS.length - 1 && <span className="mx-1 text-line">—</span>}
            </div>
          ))}
        </div>

        <div className="min-h-[300px] overflow-y-auto px-6 py-5 text-[13px] leading-relaxed">
          {step === 0 && (
            <div>
              <div className="text-[20px] font-semibold">NYX 에 오신 것을 환영합니다</div>
              <p className="mt-2 text-muted">시나리오(PDF)나 영상 콘티를 넣으면 에셋 → 샷 분해 → 콘티 이미지 → 시트(PDF) → 사내 게시·리뷰까지 한 흐름으로 만듭니다.</p>
              <ol className="mt-4 space-y-1.5 text-[12.5px]">
                <li>
                  <b>Sources</b> — 시나리오 PDF 를 넣으면 씬이 나뉩니다. 영상 콘티는 컷·대사를 찾아 원본 프레임으로 채웁니다.
                </li>
                <li>
                  <b>Assets · Shots</b> — 오른쪽 AI 채팅에 "이 씬 샷 분해해줘"처럼 말하면 됩니다. 슬래시 명령은 필요 없습니다.
                </li>
                <li>
                  <b>Conti</b> — 컷을 골라 크게 보고 주석·사이즈·앵글을 고칩니다. 생성은 항상 승인 카드를 거치고, "1장만 먼저"로 그림체를 확인할 수 있습니다.
                </li>
                <li>
                  <b>Conti Export · Publish</b> — 이미지가 다 되면 애니매틱으로 흐름을 확인하고 PDF·PNG·mp4 를 뽑아, 사내 뷰어 링크로 공유해 코멘트를 받습니다.
                </li>
              </ol>
              <p className="mt-4 text-[12px] text-muted">다음 몇 단계에서 로그인과 필요한 도구를 점검합니다. 2–3분이면 끝납니다.</p>
            </div>
          )}

          {step === 1 && (
            <div>
              <div className="text-[16px] font-semibold">AI 계정</div>
              <p className="mt-1 text-[12.5px] text-muted">Claude Code 나 Codex 중 하나만 로그인돼 있으면 됩니다. 이미지 생성을 하려면 Higgsfield 도 필요합니다. 앱은 비밀번호·토큰을 저장하지 않고 각 공식 로그인 창을 띄웁니다.</p>
              <div className="mt-3 space-y-2">
                {(accounts ?? []).map((a) => (
                  <div key={a.tool} className="flex items-center gap-3 rounded-md border border-line p-3">
                    <div className="w-28 font-medium">{a.tool === 'claude' ? 'Claude Code' : a.tool === 'codex' ? 'Codex' : 'Higgsfield'}</div>
                    <div className="min-w-0 flex-1 text-[12px]">
                      {!a.installed ? (
                        <span className="text-red-300">설치 안 됨{a.tool === 'claude' ? ' — npm i -g @anthropic-ai/claude-code' : a.tool === 'codex' ? ' — npm i -g @openai/codex' : ' — npm i -g @higgsfield/cli'}</span>
                      ) : a.loggedIn ? (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 size={13} /> {a.account ?? '로그인됨'}
                        </span>
                      ) : (
                        <span className="text-warn">로그인 필요</span>
                      )}
                    </div>
                    {a.installed && !a.loggedIn && (
                      <button disabled={!!busy} onClick={() => (setBusy(a.tool), void window.conti.auth.login(a.tool).catch(() => setBusy(null)))} className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50">
                        {busy === a.tool ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />} 로그인
                      </button>
                    )}
                  </div>
                ))}
                {!accounts && <div className="text-muted">확인 중…</div>}
              </div>
              {busy && <p className="mt-2 text-[12px] text-muted">브라우저에서 로그인을 마치면 여기 상태가 바뀝니다.</p>}
              {accounts && !aiOk && <p className="mt-3 flex items-center gap-1 text-[12px] text-warn"><AlertTriangle size={13} /> AI 계정이 없으면 채팅·샷 분해·영상 분석의 AI 판단을 쓸 수 없습니다 (나중에 설정 › 계정에서 해도 됩니다).</p>}
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="flex items-center justify-between">
                <div className="text-[16px] font-semibold">도구</div>
                <button onClick={loadTools} className="flex items-center gap-1 text-[12px] text-muted hover:text-ink">
                  <RefreshCw size={12} /> 다시 확인
                </button>
              </div>
              <div className="mt-3 space-y-2 text-[12.5px]">
                <div className="rounded-md border border-line p-3">
                  <div className="flex items-center gap-2 font-medium">
                    ffmpeg {ffmpeg?.installed ? <CheckCircle2 size={13} className="text-emerald-400" /> : <AlertTriangle size={13} className="text-warn" />}
                    <span className="text-[11.5px] font-normal text-muted">{ffmpeg?.installed ? ffmpeg.version : '영상 가져오기·애니매틱 mp4 에 필요'}</span>
                  </div>
                  {!ffmpeg?.installed && (
                    <div className="mt-2 flex items-center gap-2">
                      <code className="rounded bg-bg px-2 py-1 font-mono text-[12px]">brew install ffmpeg</code>
                      <button onClick={() => void navigator.clipboard?.writeText('brew install ffmpeg')} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-ink">
                        <Copy size={11} /> 복사
                      </button>
                      <span className="text-[11.5px] text-muted">터미널에 붙여넣고 끝나면 [다시 확인]</span>
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-line p-3">
                  <div className="font-medium">영상 분석 도구 (Python · 음성 인식)</div>
                  <div className="mt-1 text-[12px] text-muted">처음 영상을 가져올 때 앱이 자동으로 준비합니다 — 이 맥 안의 앱 폴더에만 설치되고 시스템은 건드리지 않습니다. 음성 모델(약 1.5GB)은 대사 인식을 켤 때 한 번 내려받습니다.</div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="text-[16px] font-semibold">게시 서버 (선택)</div>
              <p className="mt-1 text-[12.5px] text-muted">팀 사내 뷰어 서버 주소와 게시 토큰을 받았다면 넣어 두세요. 콘티를 링크로 공유하고 리뷰 코멘트를 받아옵니다. 없으면 건너뛰어도 됩니다.</p>
              <div className="mt-3">
                <ServerSettings />
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <div className="text-[18px] font-semibold">준비됐습니다</div>
              <ul className="mt-3 space-y-1 text-[12.5px]">
                <li className={aiOk ? 'text-emerald-400' : 'text-warn'}>{aiOk ? '✓ AI 계정 연결됨' : '△ AI 계정 없음 — 설정 › 계정'}</li>
                <li className={accounts?.find((a) => a.tool === 'higgsfield')?.loggedIn ? 'text-emerald-400' : 'text-muted'}>{accounts?.find((a) => a.tool === 'higgsfield')?.loggedIn ? '✓ Higgsfield 연결됨 (이미지 생성)' : '· Higgsfield 없음 — 생성할 때 연결'}</li>
                <li className={ffmpeg?.installed ? 'text-emerald-400' : 'text-muted'}>{ffmpeg?.installed ? '✓ ffmpeg' : '· ffmpeg 없음 — 영상 기능을 쓸 때 설치'}</li>
              </ul>
              <p className="mt-4 text-[12.5px] text-muted">다음 화면에서 프로젝트 폴더를 만들거나 엽니다. 이 안내는 설정 › 계정 옆 "처음 안내 다시 보기"로 다시 볼 수 있습니다.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <button onClick={() => void finish()} className="text-[12px] text-muted hover:text-ink">
            건너뛰기
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-[12.5px] hover:bg-panel-2">
                <ArrowLeft size={13} /> 이전
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep(step + 1)} className="flex items-center gap-1 rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white">
                다음 <ArrowRight size={13} />
              </button>
            ) : (
              <button onClick={() => void finish()} className="rounded-md bg-accent px-4 py-1.5 text-[12.5px] font-medium text-white">
                시작하기
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
