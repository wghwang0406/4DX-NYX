// config.md — 기존 스킬(runner.py load_config)이 읽는 형식을 그대로 낸다.

export interface ConfigMd {
  code: string
  title: string
  type: string
  episodeMap: Record<string, string>
}

/** `key: value` 한 줄 형식이라 제목의 줄바꿈은 공백으로 편다. */
const line = (s: string) => s.replace(/\s*\r?\n+\s*/g, ' ').trim()

export function renderConfigMd(c: ConfigMd): string {
  const rows = Object.entries(c.episodeMap)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([seq, ep]) => `| ${seq} | ${ep} |`)
  return [
    `# ${line(c.title)} — Config`,
    '',
    `project_code: ${c.code}`,
    `project_title: ${line(c.title)}`,
    `project_type: ${c.type}`,
    '',
    '## Episode Mapping',
    '| Sequence | Episode |',
    '|---|---|',
    ...rows,
    '',
  ].join('\n')
}

/** runner.py 와 같은 관용 파서: `| S41 | EP01 |` 행만 매핑으로 읽는다. */
export function parseConfigMd(text: string): ConfigMd {
  const out: ConfigMd = { code: '', title: '', type: 'drama', episodeMap: {} }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('project_code:')) out.code = line.slice('project_code:'.length).trim()
    else if (line.startsWith('project_title:')) out.title = line.slice('project_title:'.length).trim()
    else if (line.startsWith('project_type:')) out.type = line.slice('project_type:'.length).trim()
    else if (line.startsWith('|')) {
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim())
      if (cells.length >= 2 && /^S\d+$/.test(cells[0]) && /^EP\d+$/.test(cells[1])) out.episodeMap[cells[0]] = cells[1]
    }
  }
  return out
}
