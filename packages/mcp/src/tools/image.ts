import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { z } from 'zod'
import { absPath } from '@conti/core'
import { SeqId, ShotNo } from '@conti/domain'
import { defineTool } from '../context'
import { ToolError } from '../util'
import { requireSequence } from './sequence'

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

type SharpLike = (input: Buffer) => {
  metadata(): Promise<{ width?: number; height?: number }>
  resize(o: { width: number; height: number; fit: 'inside'; withoutEnlargement: boolean }): { toBuffer(): Promise<Buffer> }
}

let sharpPromise: Promise<SharpLike | null> | null = null
/** optionalDependency — 없으면 리사이즈 없이 원본을 보낸다. */
function loadSharp(): Promise<SharpLike | null> {
  sharpPromise ??= import('sharp').then(
    (m) => (m.default ?? m) as unknown as SharpLike,
    () => null,
  )
  return sharpPromise
}

/** sharp 가 없을 때 PNG IHDR 에서 크기만 읽는다. */
function pngDims(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

export const imageTools = [
  defineTool({
    name: 'image_view',
    description: '이미지를 이미지 블록으로 돌려준다 — path(프로젝트 상대경로) 또는 {seq, shotNo}(그 샷의 현재 콘티 버전). 긴 변을 max(기본 1024)px 로 줄여 토큰을 아낀다.',
    input: { path: z.string().optional(), seq: SeqId.optional(), shotNo: ShotNo.optional(), max: z.number().int().min(64).max(4096).default(1024) },
    handler: async ({ path: givenPath, seq, shotNo, max }, ctx) => {
      const { projectRoot } = ctx
      let path = givenPath
      if (!path) {
        if (!seq || !shotNo) throw new ToolError('path 또는 seq+shotNo 가 필요합니다')
        const s = requireSequence(ctx, seq)
        const sh = s.shots.find((x) => !x.deleted && x.no === shotNo)
        if (!sh) throw new ToolError(`샷 없음: ${seq} ${shotNo}`)
        const all = sh.panels.flatMap((p) => p.versions.conti)
        const cur = (sh.stages.conti.currentVersionId && all.find((v) => v.id === sh.stages.conti.currentVersionId)) || [...all].sort((a, b) => b.n - a.n)[0]
        if (!cur) throw new ToolError(`${shotNo}: 콘티 이미지가 아직 없습니다`)
        path = cur.file
      }
      const mime = MIME[extname(path).toLowerCase()]
      if (!mime) throw new ToolError(`지원하지 않는 이미지 형식: ${path} (png/jpg/webp)`)
      let abs: string
      try {
        abs = absPath(projectRoot, path)
      } catch {
        throw new ToolError(`프로젝트 밖 경로는 열 수 없습니다: ${path}`)
      }
      let buf: Buffer
      try {
        buf = await readFile(abs)
      } catch {
        throw new ToolError(`파일 없음: ${path}`)
      }
      let width: number | undefined
      let height: number | undefined
      let resized = false
      const sharp = await loadSharp()
      if (sharp) {
        const meta = await sharp(buf).metadata()
        width = meta.width
        height = meta.height
        if (width && height && Math.max(width, height) > max) {
          buf = await sharp(buf).resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).toBuffer()
          const scale = max / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
          resized = true
        }
      } else {
        const d = pngDims(buf)
        width = d?.width
        height = d?.height
      }
      const dims = width && height ? `${width}x${height}` : '크기 미상'
      return {
        content: [
          { type: 'text', text: `${path} ${dims}${resized ? ` (축소, 원본 긴 변 > ${max})` : ''}${sharp ? '' : ' (sharp 없음 — 원본 그대로)'}` },
          { type: 'image', data: buf.toString('base64'), mimeType: mime },
        ],
      }
    },
  }),
]
