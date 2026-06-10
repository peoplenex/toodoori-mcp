# @peoplenexteam/toodoori-mcp

LLM(Claude 등)이 toodoori 할 일 관리를 수행하도록, 기존 `/api/v1`를 감싸는 **얇은 stdio MCP 서버**입니다.
인가 로직을 새로 만들지 않고 PAT를 달아 toodoori 서버의 가드 체인을 그대로 거칩니다.

## 환경변수

- `TOODOORI_PAT` (필수): 개인 액세스 토큰 `tdr_pat_...`. toodoori 설정 → PAT 발급에서 생성.
- `TOODOORI_API_BASE`: API 베이스 URL. **`https://api.toodoori.com` 로 지정하세요.** 미지정 시 로컬 개발용 `http://localhost:3100`으로 향해, 운영 사용자는 모든 도구 호출이 실패합니다.

## 설치 (npx)

별도 클론/빌드 없이 `npx`로 실행합니다.

1. **PAT 발급**: toodoori.com 로그인 → 마이페이지 → 액세스 토큰 → 필요한 스코프만 골라 발급. 토큰은 **1회만 표시**되니 안전히 보관(`tdr_pat_...`).
2. **MCP 클라이언트 등록** (아래 도구별)

### Claude Desktop

`claude_desktop_config.json`에 추가하고 `tdr_pat_...`만 본인 토큰으로 교체:

```jsonc
{
  "mcpServers": {
    "toodoori": {
      "command": "npx",
      "args": ["-y", "@peoplenexteam/toodoori-mcp"],
      "env": {
        "TOODOORI_PAT": "tdr_pat_...",
        "TOODOORI_API_BASE": "https://api.toodoori.com"
      }
    }
  }
}
```

이 설정 파일은 사용자 홈 폴더(`~/Library/Application Support/Claude/`)에 있어 코드 저장소(git)에 올라가지 않습니다. 토큰은 평문 저장되니 최소 권한·짧은 만료로 발급하고 유출 시 폐기/회전하세요.

### Claude Code

> ⚠️ 토큰을 `--env`로 직접 넣으면 **현재 프로젝트에만** 등록되고, 토큰이 파일에 남아 **실수로 git에 올라갈 수 있습니다.** 토큰은 셸 환경변수로 두고 **사용자 스코프**로 등록하세요.

```bash
# 1) 셸 프로필(~/.zshrc 등)에 토큰을 export
export TOODOORI_PAT="tdr_pat_..."
export TOODOORI_API_BASE="https://api.toodoori.com"

# 2) 사용자 스코프로 등록 — 토큰을 명령에 넣지 않음(모든 프로젝트에서 사용)
claude mcp add --scope user toodoori -- npx -y @peoplenexteam/toodoori-mcp
```

등록 정보는 `~/.claude.json`에 저장되며 **토큰은 포함되지 않습니다**(실행 시 셸 환경변수를 상속). 환경변수가 설정된 터미널에서 `claude`를 실행하세요.

> 팀 공유 시: 토큰을 넣은 채 `--scope project`(저장소의 `.mcp.json`)로 등록하지 마세요. 토큰 없는 설정만 커밋하고 각자 셸 환경변수로 토큰을 주입하도록 안내하세요.

## 동작 확인

- **Claude Code**: `claude mcp get toodoori` → `Status: ✔ Connected`. 새 세션의 `/mcp`에서도 connected.
- **Claude Desktop**: 입력창의 도구(망치) 아이콘에 toodoori 도구가 보이면 정상.
- **토큰만 단독 검증**: `curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOODOORI_PAT" https://api.toodoori.com/api/v1/projects` → `200`이면 정상(`401`=무효, `403`=스코프 부족).

> 환경변수(`${TOODOORI_PAT}`)는 **클라이언트 실행 시점의 셸 환경**에서 읽힙니다. `~/.zshrc`에 추가한 뒤에는 **새 셸에서 클라이언트를 재시작**해야 적용됩니다(이미 떠 있는 세션에서 `/mcp` 재연결만으로는 안 됨).

## 문제 해결

자주 겪는 증상과 대응:

- **`Failed to reconnect to toodoori: -32000` / 도구가 안 보임** → 대개 PAT가 실행 셸에 없음. `~/.zshrc`에 export 후 **새 셸에서 재시작**. 과거 로컬 경로(`node .../dist/index.js`)로 등록했다면 npx 설정으로 교체.
- **연결은 되는데 호출이 전부 실패 — `API 연결 실패(http://localhost:3100)`** → `TOODOORI_API_BASE=https://api.toodoori.com` 누락.
- **호출이 `401 INVALID_TOKEN`** → PAT 만료/회전/오타. 재발급 후 교체.
- **토큰이 로그·트랜스크립트에 노출됨** → 즉시 회전하고, Claude Code에선 `${TOODOORI_PAT}` 환경변수 참조 방식을 사용.

증상별 원인·해결, 진단 흐름도, 진단 명령 모음은 **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** 참고.

## 도구 (24개)

- **읽기(10)**: `list_projects` · `get_project_board` · `get_project_stages` · `search_all_tasks`(전역) · `search_tasks`(프로젝트) · `get_task` · `list_labels` · `list_sub_projects` · `get_sub_project` · `read_attachment`(텍스트는 내용, 바이너리는 다운로드 URL)
- **쓰기·작업(12)**: `create_task` · `update_task` · `move_task` · `move_tasks` · `update_task_labels` · `archive_task` · `archive_tasks` · `delete_task` · `create_checklist_item` · `update_checklist_item` · `create_task_note` · `upload_task_attachment`(content 텍스트 또는 filePath 로컬 파일, 첨부 권한 필요)
- **쓰기·라벨/하위(2)**: `create_label` · `update_sub_project`

### 규약

- **ID**: `projectId`/`subProjectId`는 인코딩 문자열(목록 도구의 `id`에서만 획득, 파싱 금지). `stageId`/`labelId`는 raw 정수(`get_project_stages`/`list_labels`에서 획득). `taskNumber`는 프로젝트별 번호.
- **콘텐츠**: `content`/`retrospective`/노트는 **markdown 문자열**로 전달합니다.
- **에러**: 단일 엔벨로프 `{ error, code, status }`를 그대로 반환(LLM이 `code`로 자가 교정). 4xx는 재시도 금지.
- **마감일** = `expectedEnd`. "마감 없음"은 `dateField=expectedEnd, dateMatch=null`, "기간 내 또는 없음"은 `dateMatch=rangeOrNull`.
