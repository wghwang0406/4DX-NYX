import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectStore } from '@conti/core'
import { applyJudgements, buildShots, evidenceHash, importVideo, normalize, pass1Prompt, pass2Targets, rowsFor, sortClips, type Measure, type PanelJudgement } from './index'

const here = dirname(fileURLToPath(import.meta.url))
const PY_PROJECT = join(here, '..', '..', '..', 'py', 'media')
const SYS_PY = ['/usr/bin/python3', '/opt/homebrew/bin/python3'].find((p) => existsSync(p))
const HAS_FFMPEG = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const pyOk = (() => {
  if (!SYS_PY) return false
  try {
    execFileSync(SYS_PY, ['-c', 'import cv2, scenedetect, PIL, numpy'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const cam = (label = 'STATIC', extra: Partial<Measure['segments'][number]['camera']> = {}) => ({ label, dir: '', size: 'small' as const, travel: 0, scale: 1, rot: 0, jitter: 0, parallax: 0, reliable: true, path: [[0.5, 0.5]] as Array<[number, number]>, end_quad: null, ...extra })
const subj = { level: 'low' as const, mag: 0, dir: '', dx: 0, dy: 0 }
function fixture(): Measure {
  const samples = Array.from({ length: 80 }, (_, i) => ({ t: i / 8, sharp: 100 + (i % 7) * 10, phash: i < 40 ? '0f0f0f0f0f0f0f0f' : 'f0f0f0f0f0f0f0f0', lab: [50, 0, 0] as [number, number, number], motion: 0, subject: 0 }))
  return {
    version: 1,
    fps: 24,
    frames: 240,
    width: 1920,
    height: 1080,
    duration: 10,
    rate: 8,
    candidates: 3,
    boundaries: [],
    samples,
    segments: [
      { t0: 0, t1: 3, uncertain_in: false, camera: cam('PAN', { dir: '→', path: [[0.5, 0.5], [0.7, 0.5]] }), subject: subj, panels: [{ t0: 0, t1: 3, split: '', key: 1.5 }] },
      { t0: 3, t1: 6, uncertain_in: true, camera: cam('STATIC', { reliable: false }), subject: { level: 'high', mag: 0.02, dir: '→', dx: 0.3, dy: 0 }, panels: [{ t0: 3, t1: 4.5, split: 'view', key: 3.5 }, { t0: 4.5, t1: 6, split: 'view', key: 5 }] },
      { t0: 6, t1: 8, uncertain_in: false, camera: cam('ZOOM IN', { end_quad: [0.3, 0.3, 0.7, 0.7] }), subject: subj, panels: [{ t0: 6, t1: 8, split: '', key: 7 }] },
      { t0: 8, t1: 10, uncertain_in: false, camera: cam(), subject: subj, panels: [{ t0: 8, t1: 10, split: '', key: 9 }] },
    ],
  }
}

describe('merge', () => {
  it('numbers shots, keeps long-take panels, camera arrows, review flags, setup groups', () => {
    const shots = buildShots(fixture(), undefined)
    expect(shots.map((s) => s.no)).toEqual(['0010', '0020', '0030', '0040'])
    expect(shots[0].cameraMove).toBe('PAN →')
    expect(shots[0].panels[0].annotations[0]).toMatchObject({ type: 'pan', label: 'PAN →' })
    expect(shots[1].panels.map((p) => p.label)).toEqual(['0020a', '0020b'])
    expect(shots[1].review).toEqual(['uncertain_cut', 'motion_unreliable'])
    expect(shots[1].panels[0].annotations.map((a) => a.type)).toEqual(['move']) // 피사체 이동 화살표
    expect(shots[2].panels[0].annotations[0]).toMatchObject({ type: 'zoom', points: [[0.3, 0.3], [0.7, 0.7]] })
    // pHash 가 같은 앞 절반(0..5초)은 한 그룹
    expect(shots[0].panels[0].group).toBe('G1')
    expect(shots[3].panels[0].group).toBe('G2')
  })
  it('splits a cut with N dialogue lines into N shots at silence midpoints; spill-over makes [반응]; low ASR flagged', () => {
    const asr = {
      model: 't', device: 'cpu', language: 'ko', duration: 10, dropped: 0,
      segments: [
        { t0: 8.2, t1: 8.9, text: '여기서 멈춰.', logprob: -0.2, no_speech: 0, low: false },
        { t0: 9.0, t1: 9.8, text: '왜?', logprob: -1.4, no_speech: 0, low: true },
        { t0: 2.0, t1: 3.9, text: '아무도 없잖아.', logprob: -0.3, no_speech: 0, low: false }, // 0010 → 0020 으로 0.9초 넘침
      ],
    }
    const shots = buildShots(fixture(), asr)
    expect(shots.map((s) => s.no)).toEqual(['0010', '0020', '0030', '0040', '0050'])
    const [a, b] = shots.slice(3)
    expect(a.t1).toBeCloseTo(8.95, 2)
    expect(b.t0).toBeCloseTo(8.95, 2)
    expect(a.dialogue[0].text).toBe('여기서 멈춰.')
    expect(b.review).toContain('asr_low')
    expect(a.review).toContain('tight_split') // 간격 0.1초
    expect(shots[1].tag).toBe('반응')
    expect(shots[0].tag).toBe('대사')
  })
  it('clips: child numbers from the file number and timeline offsets', () => {
    const shots = buildShots(fixture(), undefined, { baseNo: '0030', offset: 100, clipIndex: 2 })
    expect(shots.map((s) => s.no)).toEqual(['0030', '0031', '0032', '0033'])
    expect(shots[0].t0).toBe(100)
    expect(shots[1].panels[1].key).toBe(105)
    expect(shots[0].clip).toEqual({ index: 2, offset: 100 })
    expect(sortClips(['/x/S01_0020_v1.mp4', '/x/S01_0010_v2.mp4', '/x/extra.mp4'])).toEqual(['/x/S01_0010_v2.mp4', '/x/S01_0020_v1.mp4', '/x/extra.mp4'])
  })
})

describe('ai', () => {
  it('prompt is compact, judgements normalize/apply, pass2 picks ≤20% lowest', () => {
    const shots = buildShots(fixture(), { model: 't', device: 'cpu', language: 'ko', duration: 10, dropped: 0, segments: [{ t0: 8.2, t1: 9.6, text: '여기서 멈춰.', logprob: -0.2, no_speech: 0, low: false }] })
    const rows = rowsFor(shots)
    expect(rows.map((r) => r.id)).toEqual(['0010', '0020a', '0020b', '0030', '0040'])
    const prompt = pass1Prompt(rows, 1, ['@해수(해수)'])
    expect(prompt).toMatch(/^0040 \| 00:0[89]\.\d \| STATIC \| "여기서 멈춰\."$/m)
    expect(prompt).toContain('0020a | 00:03.5 | STATIC? |')
    expect(prompt.length).toBeLessThan(2500)
    const out = {
      panels: [
        { id: '0010', size: 'WS', angle: 'eye level', chars: ['@해수'], action: '해수가 트럭 옆에 선 채로 도로를 본다', speaker: '', cam: '', conf: 0.9 },
        { id: '0020a', size: 'MS', angle: 'low', chars: ['인물 A'], action: '달리는 중', speaker: '', cam: 'PAN ←', conf: 0.4 },
        { id: '0020b', size: 'XL', angle: 'low', chars: [], action: '문을 연 채로', speaker: '', cam: '', conf: 0.8 },
        { id: '0040', size: 'CU', angle: 'eye level', chars: ['@해수'], action: '입을 연 채로', speaker: '@해수', cam: '', conf: 0.7 },
        { id: '9999', size: 'CU', angle: '', chars: [], action: '', speaker: '', cam: '', conf: 1 },
      ],
    }
    const j = normalize(out, new Set(rows.map((r) => r.id)))
    expect([...j.keys()]).toEqual(['0010', '0020a', '0020b', '0040'])
    expect(j.get('0020b')!.size).toBe('') // enum 밖
    expect(pass2Targets(j, 10)).toEqual(['0020a'])
    applyJudgements(shots, j)
    expect(shots[0]).toMatchObject({ sizeCode: 'WS', characters: ['@해수'], actionKo: '해수가 트럭 옆에 선 채로 도로를 본다' })
    expect(shots[1].cameraMove).toBe('PAN ←') // AI 정정
    expect(shots[1].review).not.toContain('motion_unreliable')
    expect(shots[1].characters).toEqual(['@인물A'])
    expect((shots[1].panels[1] as { caption?: string }).caption).toBe('문을 연 채로')
    expect(shots[3].dialogue[0].speaker).toBe('해수')
    expect(evidenceHash(rows[0], 'ab', [])).toBe(evidenceHash(rows[0], 'ab', []))
    expect(evidenceHash(rows[0], 'ab', [])).not.toBe(evidenceHash(rows[0], 'ac', []))
  })
})

describe.skipIf(!HAS_FFMPEG || !pyOk)('pipeline (system python + ffmpeg, fake AI)', () => {
  let dir: string
  let video: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nyx-media-'))
    video = join(dir, 'synth.mp4')
    const fc = "[1:v]trim=duration=3,setpts=PTS-STARTPTS[m];[3:v]drawgrid=w=80:h=80:t=3:c=white@0.8,drawbox=x=300:y=200:w=200:h=200:c=red:t=fill,crop=1280:720:'t*300':0,setpts=PTS-STARTPTS[pan];[0:v][m][2:v][pan]concat=n=4:v=1:a=0,format=yuv420p[v]"
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=3', '-f', 'lavfi', '-i', 'mandelbrot=size=1280x720:rate=24', '-f', 'lavfi', '-i', 'smptehdbars=size=1280x720:rate=24:duration=2', '-f', 'lavfi', '-i', 'color=c=0x334455:size=2560x720:rate=24:duration=4', '-filter_complex', fc, '-map', '[v]', '-c:v', 'libx264', '-crf', '23', video])
  }, 60_000)

  it('imports an animatic: proxy → measure → keyframes → AI → sequence; rerun hits every cache (0 AI calls)', async () => {
    const root = join(dir, 'proj')
    const store = await ProjectStore.create(root, { code: 'VID', title: '영상' })
    const calls: Array<{ prompt: string; images: string[] }> = []
    const runAi = async (req: { prompt: string; images?: string[] }) => {
      calls.push({ prompt: req.prompt, images: req.images ?? [] })
      const ids = [...req.prompt.matchAll(/^(\d{4}[a-z]?) \|/gm)].map((m) => m[1])
      return { data: { panels: ids.map((id, i) => ({ id, size: 'WS', angle: 'eye level', chars: [], action: `패널 ${id} 상태`, speaker: '', cam: '', conf: i === 0 ? 0.3 : 0.9 })) }, usage: { inTok: 1000, outTok: 200 }, ms: 5 } as never
    }
    const progress: string[] = []
    const deps = { store, py: { projectDir: PY_PROJECT, dataDir: join(dir, 'data'), python: SYS_PY }, runAi, onProgress: (p: { stage: string }) => progress.push(p.stage) }
    const r = await importVideo(deps as never, { kind: 'animatic', files: [video], seq: 'S01', ep: 'EP01', ai: 'claude', asr: false })
    expect(r.shots).toBe(4)
    const seq0 = store.getSequence('S01')!
    const panelCount = seq0.shots.reduce((n, s) => n + s.panels.length, 0)
    expect(r.panels).toBe(panelCount)
    expect(seq0.shots[3].panels).toHaveLength(2) // 긴 팬 → 패널 2개
    expect(r.ai).toMatchObject({ panels: panelCount, cached: 0, pass2: 1, inTok: 2000 })
    expect(calls).toHaveLength(2)
    expect(calls[0].images).toHaveLength(1) // 20칸 이하 → 시트 1장
    expect(calls[1].prompt).toContain('3프레임')
    const seq = store.getSequence('S01')!
    expect(seq.source).toMatchObject({ kind: 'video', proxy: expect.stringMatching(/proxy\.mp4$/) })
    expect(seq.shots.map((s) => s.no)).toEqual(['0010', '0020', '0030', '0040'])
    expect(seq.shots[3].cameraMove).toBe('PAN →')
    expect(seq.shots[3].panels).toHaveLength(2)
    expect(seq.shots[3].tc).toEqual({ inMs: 8000, outMs: 12000 })
    expect(seq.shots[1].actionKo).toBe('패널 0020 상태')
    expect(seq.shots[0].stages.conti.status).toBe('review')
    const files = (await readdir(join(root, 'EP01/Conti/S01'))).filter((f) => f.endsWith('.png')).sort()
    expect(files).toHaveLength(panelCount)
    expect(files).toEqual(expect.arrayContaining(['S01_0020_v1.png', 'S01_0030_v1.png', 'S01_0040-1_v1.png', 'S01_0040-2_v1.png']))
    const png = await readFile(join(root, 'EP01/Conti/S01/S01_0020_v1.png'))
    expect(png.readUInt32BE(16)).toBe(1280) // 원본 해상도
    expect(seq.shots[0].panels[0].versions.conti[0].source).toBe('video_frame')
    expect(progress).toContain('measure')
    // 다시: 같은 파일 → 프록시·측정·AI 전부 캐시
    calls.length = 0
    const r2 = await importVideo(deps as never, { kind: 'animatic', files: [video], seq: 'S01', ep: 'EP01', ai: 'claude', asr: false, overwrite: true })
    expect(calls).toHaveLength(0)
    expect(r2.ai).toMatchObject({ panels: 0, cached: panelCount, inTok: 0 })
    expect(r2.cached).toEqual(expect.arrayContaining(['proxy:synth.mp4', 'measure:synth.mp4']))
    // 덮어쓰기는 파일 번호를 밀어 쓴다 (v1 을 덮지 않음)
    expect((await readdir(join(root, 'EP01/Conti/S01'))).filter((f) => f.startsWith('S01_0020_')).sort()).toEqual(['S01_0020_v1.png', 'S01_0020_v2.png'])
    await expect(importVideo(deps as never, { kind: 'animatic', files: [video], seq: 'S01', ep: 'EP01', ai: null, asr: false })).rejects.toThrow(/이미 샷이 있습니다/)
  }, 120_000)

  it('imports per-shot clips with file numbers, child numbers for inner cuts, and a concatenated playback proxy', async () => {
    const root = join(dir, 'proj2')
    const store = await ProjectStore.create(root, { code: 'CLP', title: '클립' })
    const a = join(dir, 'S02_0010_v1.mp4')
    const b = join(dir, 'S02_0020_v1.mp4')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'smptehdbars=size=640x360:rate=24:duration=2', '-c:v', 'libx264', b])
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-t', '7', '-c:v', 'libx264', a]) // 컷 2개 → 0010, 0011, 0012
    const r = await importVideo({ store, py: { projectDir: PY_PROJECT, dataDir: join(dir, 'data'), python: SYS_PY } } as never, { kind: 'clips', files: [b, a], seq: 'S02', ep: 'EP01', ai: null, asr: false })
    const seq = store.getSequence('S02')!
    expect(seq.shots.map((s) => s.no)).toEqual(['0010', '0011', '0012', '0020'])
    expect(seq.shots[3].tc!.inMs).toBe(7000)
    expect(r.ai).toBeNull()
    expect(seq.source.proxy).toMatch(/cache\/video\/[0-9a-f]{16}\/proxy\.mp4$/)
    expect(existsSync(join(root, seq.source.proxy!))).toBe(true)
  }, 120_000)
})
