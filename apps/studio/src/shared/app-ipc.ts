// 앱 전반(첫 실행 안내·새 버전·진단 내보내기) ↔ 렌더러 계약
export interface AppSettings {
  onboarded: boolean
  onboardedAt?: number
  /** 이 버전 알림은 다시 보지 않기 */
  skipVersion?: string
}

export interface UpdateInfo {
  version: string
  current: string
  url: string
  notes?: string
  size?: number
}

export interface AppApi {
  version(): Promise<string>
  settings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  checkUpdate(): Promise<UpdateInfo | null>
  openDownload(url: string): Promise<void>
  exportDiagnostics(): Promise<string>
}
