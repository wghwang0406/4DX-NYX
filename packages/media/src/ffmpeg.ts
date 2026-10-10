// ffmpeg / ffprobe — 인자 배열로만 실행 (셸 없음). 분석 프록시·오디오·키프레임 추출.
import crossSpawn from 'cross-spawn'
import { findBin } from '@conti/agents'
import type { Probe } from './types'

export interface Bins {
  ffmpeg: string
  ffprobe: string
}

export async function findFfmpeg(): Promise<Bins> {
  const ffmpeg = await findBin('ffmpeg')
  const ffprobe = await findBin('ffprobe')
  if (!ffmpeg || !ffprobe) throw new Error('ffmpeg/ffprobe 가 없습니다 — `brew install ffmpeg` 후 다시 시도하세요')
  return { ffmpeg, ffprobe }
}

export function run(bin: string, args: string[], onStderr?: (s: string) => void): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString('utf8')
      stderr = (stderr + s).slice(-8000)
      onStderr?.(s)
    })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${bin.split('/').pop()} 실패 (exit ${code}): ${stderr.trim().split('\n').slice(-3).join(' / ')}`))))
  })
}

function parseRate(r?: string): number {
  if (!r) return 0
  const [a, b] = r.split('/').map(Number)
  return b ? a / b : a || 0
}

export async function probe(bins: Bins, file: string): Promise<Probe> {
  const { stdout } = await run(bins.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<Record<string, any>> }
  const v = j.streams?.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  const a = j.streams?.find((s) => s.codec_type === 'audio')
  const r = parseRate(v?.r_frame_rate)
  const avg = parseRate(v?.avg_frame_rate)
  return {
    duration: Number(j.format?.duration ?? v?.duration ?? a?.duration ?? 0),
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    fps: avg || r || 0,
    vfr: !!(r && avg && Math.abs(r - avg) > 0.01),
    hasAudio: !!a,
    hasVideo: !!v,
    codec: v?.codec_name,
  }
}

/** 분석·재생용 프록시: 폭 960, CFR, 올-키프레임(어디로 가든 즉시 탐색), 오디오 mono aac. VFR 원본도 CFR 로 고정한다. */
export function proxyArgs(src: string, out: string, fps: number, hasAudio: boolean): string[] {
  const rate = fps > 0 && fps <= 60 ? Math.round(fps * 1000) / 1000 : 24
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', src,
    '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []),
    '-vf', `scale=960:-2:flags=area,fps=${rate}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '1', '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', '96k', '-ac', '1'] : ['-an']),
    '-movflags', '+faststart',
    out,
  ]
}

/** 음성 인식용 16kHz mono wav */
export function audioArgs(src: string, out: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out]
}

/** 원본 해상도 키프레임 1장 (정확 탐색: -ss 를 -i 뒤에 두면 느리므로 앞에 두되 accurate_seek 기본값 사용) */
export function frameArgs(src: string, t: number, out: string, width?: number): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(Math.max(0, Math.round(t * 1000) / 1000)),
    '-i', src,
    '-frames:v', '1',
    ...(width ? ['-vf', `scale=${width}:-2:flags=area`] : []),
    ...(out.endsWith('.jpg') ? ['-q:v', '3'] : []),
    out,
  ]
}

/** 샷별 클립 프록시를 하나로 (같은 인코딩이라 재인코딩 없이) — 재생용 */
export function concatArgs(listFile: string, out: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', out]
}
