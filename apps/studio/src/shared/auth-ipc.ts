// 계정(로그인) 설정 ↔ 렌더러 계약. 앱은 토큰을 다루지 않고 공식 CLI 의 login/logout 을 대신 띄운다.
export type AuthTool = 'claude' | 'codex' | 'higgsfield'

export interface AccountStatus {
  tool: AuthTool
  installed: boolean
  loggedIn: boolean
  /** 표시용 계정 (이메일) */
  account?: string
  /** 조직·플랜·인증 방식 같은 부가 정보 */
  detail?: string
  /** 로그인 진행 중 */
  busy: boolean
}

export interface LoginOptions {
  /** claude: 구독(claude.ai, 기본) / Console API */
  claudeMode?: 'claudeai' | 'console'
  /** claude: 로그인 페이지에 미리 채울 이메일 */
  email?: string
}

export type AuthEvent =
  | { t: 'started'; tool: AuthTool }
  | { t: 'url'; tool: AuthTool; url: string }
  | { t: 'needs_code'; tool: AuthTool }
  | { t: 'log'; tool: AuthTool; text: string }
  | { t: 'done'; tool: AuthTool; status: AccountStatus }
  | { t: 'error'; tool: AuthTool; message: string; status?: AccountStatus }
  | { t: 'logged_out'; tool: AuthTool; status: AccountStatus }

export interface AuthApi {
  status(): Promise<AccountStatus[]>
  login(tool: AuthTool, opts?: LoginOptions): Promise<void>
  pasteCode(tool: AuthTool, code: string): Promise<void>
  cancel(tool: AuthTool): Promise<void>
  logout(tool: AuthTool): Promise<AccountStatus>
  openUrl(url: string): Promise<void>
}
