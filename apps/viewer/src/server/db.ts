// SQLite (node:sqlite, 네이티브 의존성 없음). 코멘트 변경은 events 에 쌓여 스튜디오가 커서로 가져간다.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Comment, CommentKind, CommentStatus, Manifest } from '../shared/types'

export interface PubRow {
  id: string
  project_id: string
  seq: string
  version: number
  label: string
  status: string
  token: string
  manifest: string
  created_at: number
  revoked: number
  expires_at: number | null
  archive_status: string
  archive_error: string | null
  archive_path: string | null
}

export class Db {
  readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, code TEXT NOT NULL, title TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS blobs (sha256 TEXT PRIMARY KEY, size INTEGER NOT NULL, type TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS publications (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), seq TEXT NOT NULL, version INTEGER NOT NULL,
        label TEXT NOT NULL, status TEXT NOT NULL, token TEXT NOT NULL UNIQUE, manifest TEXT NOT NULL, created_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, archive_status TEXT NOT NULL DEFAULT 'pending', archive_error TEXT, archive_path TEXT
      );
      CREATE INDEX IF NOT EXISTS pub_proj ON publications(project_id, seq, version);
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES publications(id), project_id TEXT NOT NULL, seq TEXT NOT NULL, label TEXT NOT NULL,
        kind TEXT NOT NULL, shot_no TEXT, panel_index INTEGER, page INTEGER, x REAL, y REAL, w REAL, h REAL, t_ms INTEGER, frame INTEGER,
        body TEXT NOT NULL, author TEXT NOT NULL, verdict TEXT, status TEXT NOT NULL DEFAULT 'open', resolved_in TEXT, resolved_note TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS com_pub ON comments(publication_id);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, comment_id TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS ev_proj ON events(project_id, id);
    `)
  }

  close() {
    this.db.close()
  }

  upsertProject(p: { id: string; code: string; title: string }) {
    this.db.prepare('INSERT INTO projects(id, code, title, created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code, title=excluded.title').run(p.id, p.code, p.title, Date.now())
  }

  // ── blobs ──
  blobComplete(sha: string): { size: number; type: string | null } | undefined {
    return this.db.prepare('SELECT size, type FROM blobs WHERE sha256=?').get(sha) as never
  }
  addBlob(sha: string, size: number, type: string | null) {
    this.db.prepare('INSERT OR IGNORE INTO blobs(sha256, size, type, created_at) VALUES(?,?,?,?)').run(sha, size, type, Date.now())
  }

  // ── publications ──
  nextVersion(projectId: string, seq: string): number {
    const r = this.db.prepare('SELECT MAX(version) AS v FROM publications WHERE project_id=? AND seq=?').get(projectId, seq) as { v: number | null }
    return (r?.v ?? 0) + 1
  }
  insertPublication(p: { id: string; projectId: string; seq: string; version: number; label: string; status: string; token: string; manifest: Manifest; expiresAt?: number; archive: string }) {
    this.db
      .prepare('INSERT INTO publications(id, project_id, seq, version, label, status, token, manifest, created_at, expires_at, archive_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(p.id, p.projectId, p.seq, p.version, p.label, p.status, p.token, JSON.stringify(p.manifest), Date.now(), p.expiresAt ?? null, p.archive)
  }
  pubByToken(token: string): PubRow | undefined {
    return this.db.prepare('SELECT * FROM publications WHERE token=?').get(token) as never
  }
  pubById(id: string): PubRow | undefined {
    return this.db.prepare('SELECT * FROM publications WHERE id=?').get(id) as never
  }
  pubsOf(projectId: string, seq?: string): PubRow[] {
    return (seq ? this.db.prepare('SELECT * FROM publications WHERE project_id=? AND seq=? ORDER BY version DESC').all(projectId, seq) : this.db.prepare('SELECT * FROM publications WHERE project_id=? ORDER BY seq, version DESC').all(projectId)) as never
  }
  updatePub(id: string, patch: { revoked?: boolean; expiresAt?: number | null; archiveStatus?: string; archiveError?: string | null; archivePath?: string }) {
    const sets: string[] = []
    const vals: Array<string | number | null> = []
    if (patch.revoked !== undefined) sets.push('revoked=?'), vals.push(patch.revoked ? 1 : 0)
    if (patch.expiresAt !== undefined) sets.push('expires_at=?'), vals.push(patch.expiresAt)
    if (patch.archiveStatus !== undefined) sets.push('archive_status=?'), vals.push(patch.archiveStatus)
    if (patch.archiveError !== undefined) sets.push('archive_error=?'), vals.push(patch.archiveError)
    if (patch.archivePath !== undefined) sets.push('archive_path=?'), vals.push(patch.archivePath)
    if (!sets.length) return
    this.db.prepare(`UPDATE publications SET ${sets.join(', ')} WHERE id=?`).run(...vals, id)
  }
  /** 현황 화면용 — 프로젝트별 게시 판 + 코멘트 수 + 마지막 판정. 파일 총량. */
  overview(): {
    projects: Array<{ id: string; code: string; title: string; pubs: Array<PubRow & { open: number; total: number; verdict: string | null }> }>
    blobBytes: number
    blobCount: number
  } {
    const projects = this.db.prepare('SELECT id, code, title FROM projects ORDER BY created_at DESC').all() as Array<{ id: string; code: string; title: string }>
    const out = projects.map((p) => ({
      ...p,
      pubs: (this.db.prepare('SELECT * FROM publications WHERE project_id=? ORDER BY seq, version DESC').all(p.id) as unknown as PubRow[]).map((pub) => {
        const c = this.commentCounts(pub.id)
        const v = this.db.prepare("SELECT verdict FROM comments WHERE publication_id=? AND kind='verdict' ORDER BY created_at DESC LIMIT 1").get(pub.id) as { verdict: string | null } | undefined
        return { ...pub, ...c, verdict: v?.verdict ?? null }
      }),
    }))
    const b = this.db.prepare('SELECT COALESCE(SUM(size),0) AS bytes, COUNT(*) AS n FROM blobs').get() as { bytes: number; n: number }
    return { projects: out, blobBytes: b.bytes, blobCount: b.n }
  }

  commentCounts(pubId: string): { open: number; total: number } {
    const r = this.db.prepare("SELECT SUM(CASE WHEN status='open' AND kind != 'verdict' THEN 1 ELSE 0 END) AS open, COUNT(*) AS total FROM comments WHERE publication_id=?").get(pubId) as { open: number | null; total: number }
    return { open: r.open ?? 0, total: r.total }
  }

  // ── comments ──
  insertComment(c: Omit<Comment, 'updatedAt'>) {
    this.db
      .prepare(
        'INSERT INTO comments(id, publication_id, project_id, seq, label, kind, shot_no, panel_index, page, x, y, w, h, t_ms, frame, body, author, verdict, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(c.id, c.publicationId, c.projectId, c.seq, c.label, c.kind, c.shotNo ?? null, c.panelIndex ?? null, c.page ?? null, c.x ?? null, c.y ?? null, c.w ?? null, c.h ?? null, c.tMs ?? null, c.frame ?? null, c.body, c.author, c.verdict ?? null, c.status, c.createdAt, c.createdAt)
    this.event(c.projectId, c.id)
  }
  updateComment(id: string, patch: { status?: CommentStatus; resolvedIn?: string | null; resolvedNote?: string | null }): Comment | undefined {
    const cur = this.comment(id)
    if (!cur) return undefined
    this.db
      .prepare('UPDATE comments SET status=?, resolved_in=?, resolved_note=?, updated_at=? WHERE id=?')
      .run(patch.status ?? cur.status, patch.resolvedIn !== undefined ? patch.resolvedIn : (cur.resolvedIn ?? null), patch.resolvedNote !== undefined ? patch.resolvedNote : (cur.resolvedNote ?? null), Date.now(), id)
    this.event(cur.projectId, id)
    return this.comment(id)
  }
  comment(id: string): Comment | undefined {
    const r = this.db.prepare('SELECT * FROM comments WHERE id=?').get(id)
    return r ? rowToComment(r as never) : undefined
  }
  commentsOfPub(pubId: string): Comment[] {
    return (this.db.prepare('SELECT * FROM comments WHERE publication_id=? ORDER BY created_at').all(pubId) as never[]).map(rowToComment)
  }
  /** 같은 시퀀스의 모든 게시본 코멘트 — 뷰어는 이전 판 코멘트도 "vN에서 반영됨"과 함께 보여준다 */
  commentsOfSeq(projectId: string, seq: string): Comment[] {
    return (this.db.prepare('SELECT * FROM comments WHERE project_id=? AND seq=? ORDER BY created_at').all(projectId, seq) as never[]).map(rowToComment)
  }
  private event(projectId: string, commentId: string) {
    this.db.prepare('INSERT INTO events(project_id, comment_id, at) VALUES(?,?,?)').run(projectId, commentId, Date.now())
  }
  /** 커서 이후 바뀐 코멘트 (같은 코멘트가 여러 번 바뀌었으면 마지막 상태 한 번) */
  changes(projectId: string, cursor: number, limit = 500): { cursor: number; comments: Comment[] } {
    const evs = this.db.prepare('SELECT id, comment_id FROM events WHERE project_id=? AND id>? ORDER BY id LIMIT ?').all(projectId, cursor, limit) as Array<{ id: number; comment_id: string }>
    if (!evs.length) return { cursor, comments: [] }
    const ids = [...new Set(evs.map((e) => e.comment_id))]
    return { cursor: evs[evs.length - 1].id, comments: ids.map((id) => this.comment(id)!).filter(Boolean) }
  }
}

function rowToComment(r: Record<string, unknown>): Comment {
  const n = (v: unknown) => (v === null || v === undefined ? undefined : (v as number))
  const s = (v: unknown) => (v === null || v === undefined ? undefined : String(v))
  return {
    id: String(r.id),
    publicationId: String(r.publication_id),
    projectId: String(r.project_id),
    seq: String(r.seq),
    label: String(r.label),
    kind: r.kind as CommentKind,
    shotNo: s(r.shot_no),
    panelIndex: n(r.panel_index),
    page: n(r.page),
    x: n(r.x),
    y: n(r.y),
    w: n(r.w),
    h: n(r.h),
    tMs: n(r.t_ms),
    frame: n(r.frame),
    body: String(r.body),
    author: String(r.author),
    verdict: s(r.verdict) as Comment['verdict'],
    status: r.status as CommentStatus,
    resolvedIn: s(r.resolved_in),
    resolvedNote: s(r.resolved_note),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }
}
