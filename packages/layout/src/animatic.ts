// 자동 애니매틱 — 콘티 이미지를 샷 길이대로 이어 붙인 mp4 (로컬 ffmpeg, 크레딧 0).
// ffmpeg concat demuxer 목록을 만들고 인자 배열을 돌려준다. 실행은 호출자(main)가 한다 (셸 없음).

export interface AnimaticItem {
  absImage: string
  durationSec: number
}

/** concat demuxer 목록 — 마지막 이미지는 한 번 더 적어야 마지막 duration 이 적용된다 (ffmpeg 규칙). */
export function concatList(items: AnimaticItem[]): string {
  const q = (p: string) => `'${p.replace(/'/g, "'\\''")}'`
  const lines: string[] = ['ffconcat version 1.0']
  for (const it of items) {
    lines.push(`file ${q(it.absImage)}`)
    lines.push(`duration ${Math.max(0.1, Math.round(it.durationSec * 1000) / 1000)}`)
  }
  if (items.length) lines.push(`file ${q(items[items.length - 1].absImage)}`)
  return lines.join('\n') + '\n'
}

export interface AnimaticArgs {
  listFile: string
  outFile: string
  width?: number
  height?: number
  fps?: number
  codec?: 'libx264' | 'mpeg4'
  /** 전체 길이 — concat 의 마지막 반복 항목이 길이를 늘리므로 출력에서 정확히 자른다 */
  totalSec?: number
}

export function animaticArgs(a: AnimaticArgs): string[] {
  const w = a.width ?? 1920
  const h = a.height ?? 1080
  const fps = a.fps ?? 24
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${fps},format=yuv420p`
  const codec = a.codec ?? 'libx264'
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    a.listFile,
    '-vf',
    vf,
    '-c:v',
    codec,
    ...(codec === 'libx264' ? ['-preset', 'veryfast', '-crf', '20'] : ['-q:v', '3']),
    ...(a.totalSec ? ['-t', String(Math.round(a.totalSec * 1000) / 1000)] : []),
    '-movflags',
    '+faststart',
    a.outFile,
  ]
}
