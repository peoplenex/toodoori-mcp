/**
 * 환경 설정.
 *
 * - TOODOORI_PAT       (필수) 개인 액세스 토큰 `tdr_pat_...`
 * - TOODOORI_API_BASE  (선택) API 베이스. 기본 로컬 dev `http://localhost:3100`.
 *                       운영은 `https://api.toodoori.com` 으로 지정.
 */
export interface McpConfig {
  /** PAT (Authorization: Bearer) */
  pat: string;
  /** `/api/v1` 까지 포함한 최종 베이스 URL */
  apiBase: string;
  /** 원본 베이스(로그/표시용) */
  origin: string;
}

export function loadConfig(): McpConfig {
  const pat = process.env.TOODOORI_PAT?.trim();
  if (!pat) {
    throw new Error('TOODOORI_PAT 환경변수가 필요합니다. MCP 클라이언트 설정의 env에 PAT(tdr_pat_...)를 넣으세요.');
  }

  const origin = (process.env.TOODOORI_API_BASE?.trim() || 'http://localhost:3100').replace(/\/+$/, '');
  const apiBase = `${origin}/api/v1`;

  return { pat, apiBase, origin };
}
