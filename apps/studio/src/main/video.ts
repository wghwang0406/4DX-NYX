// VideoService — 영상 콘티 가져오기 (플랜 §4). 무거운 일은 @conti/media 가, 여기선 파일 선택·진행 전달·AI 선택만.
import { app, dialog, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ProjectStore } from '@conti/core'
import { pickAvailable } from '@conti/agents'
import { importVideo, type ImportProgress, type PyConfig } from '@conti/media'
import type { VideoImportOptions, VideoImportSummary } from '../shared/video-ipc'

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'mxf']
const AUDIO_EXT = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'aiff', 'aif']

export class VideoService {
  private running = false

  constructor(
    private getStore: () => ProjectStore | null,
    private getWindow: () => BrowserWindow | null,
  ) {}

  pyConfig(): PyConfig {
    const packaged = app.isPackaged
    return {
      projectDir: packaged ? join(process.resourcesPath, 'py', 'media') : join(app.getAppPath(), '..', '..', 'py', 'media'),
      dataDir: app.getPath('userData'),
      bundledUv: packaged ? join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv') : undefined,
      // 개발·검증용: CONTI_PYTHON=/usr/bin/python3 이면 uv 없이 그 파이썬으로
      python: process.env.CONTI_PYTHON || undefined,
    }
  }

  async pick(kind: VideoImportOptions['kind']): Promise<string[]> {
    const win = this.getWindow()
    const audio = kind === 'audio'
    const opts = {
      title: audio ? '대사 음성 파일' : kind === 'clips' ? '샷별 클립 (여러 개 선택)' : '영상 콘티',
      properties: (kind === 'clips' ? ['openFile', 'multiSelections'] : ['openFile']) as Array<'openFile' | 'multiSelections'>,
      filters: [audio ? { name: '오디오', extensions: [...AUDIO_EXT, ...VIDEO_EXT] } : { name: '영상', extensions: VIDEO_EXT }],
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  }

  /** 비어 있는 다음 시퀀스 번호 (S01, S02 …) */
  suggest(): { seq: string; ep: string } {
    const store = this.getStore()
    const seqs = store?.listSequences() ?? []
    const nums = seqs.map((s) => Number(s.seq.slice(1))).filter(Number.isFinite)
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    return { seq: `S${String(next).padStart(2, '0')}`, ep: seqs[seqs.length - 1]?.ep ?? 'EP01' }
  }

  async import(o: VideoImportOptions): Promise<VideoImportSummary> {
    const store = this.getStore()
    if (!store) throw new Error('열린 프로젝트가 없습니다')
    if (this.running) throw new Error('이미 가져오는 중입니다')
    this.running = true
    try {
      const ai = o.ai === 'auto' ? await pickAvailable('claude') : o.ai === 'none' ? null : o.ai
      const r = await importVideo(
        { store, py: this.pyConfig(), onProgress: (p: ImportProgress) => this.getWindow()?.webContents.send('video:progress', p) },
        { kind: o.kind, files: o.files, seq: o.seq, ep: o.ep, headingKo: o.headingKo || undefined, asr: o.asr, asrModel: o.asrModel, asrLang: o.asrLang, ai, overwrite: o.overwrite },
      )
      return { ...r, aiAgent: ai }
    } finally {
      this.running = false
    }
  }
}
