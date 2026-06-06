# @toodoori/mcp

LLM(Claude 등)이 toodoori 할 일 관리를 수행하도록, 기존 `/api/v1`를 감싸는 **얇은 stdio MCP 서버**입니다.
인가 로직을 새로 만들지 않고 PAT를 달아 서버 가드 체인을 그대로 거칩니다(설계: [`../docs/ai-integration/mcp-design.md`](../docs/ai-integration/mcp-design.md)).

## 환경변수

- `TOODOORI_PAT` (필수): 개인 액세스 토큰 `tdr_pat_...` (설정 → PAT 발급)
- `TOODOORI_API_BASE` (선택): API 베이스. 기본 **로컬 dev `http://localhost:3100`**. 운영은 `https://api.toodoori.com`.
  - ⚠️ PAT는 **발급한 환경**에서만 유효합니다(로컬에서 발급 → 로컬 base, 운영에서 발급 → 운영 base).

## 빌드

```bash
yarn install
yarn build      # tsc → dist/
```

## MCP 클라이언트 등록 (로컬, npm 불필요)

### Claude Desktop — `claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "toodoori": {
      "command": "node",
      "args": ["/Users/junep/Desktop/Projects/toodoori-server/mcp/dist/index.js"],
      "env": {
        "TOODOORI_PAT": "tdr_pat_...",
        "TOODOORI_API_BASE": "http://localhost:3100",
      },
    },
  },
}
```

### Claude Code

```bash
claude mcp add --transport stdio \
  --env TOODOORI_PAT=tdr_pat_... \
  --env TOODOORI_API_BASE=http://localhost:3100 \
  toodoori -- node /Users/junep/Desktop/Projects/toodoori-server/mcp/dist/index.js
```

> 로컬 base를 쓰면 **dev 서버(`yarn dev`)가 떠 있어야** 합니다.

## 도구 (24개)

- **읽기(10)**: `list_projects` · `get_project_board` · `get_project_stages` · `search_all_tasks`(전역) · `search_tasks`(프로젝트) · `get_task` · `list_labels` · `list_sub_projects` · `get_sub_project` · `read_attachment`(텍스트는 내용, 바이너리는 다운로드 URL)
- **쓰기·작업(12)**: `create_task` · `update_task` · `move_task` · `move_tasks` · `update_task_labels` · `archive_task` · `archive_tasks` · `delete_task` · `create_checklist_item` · `update_checklist_item` · `create_task_note` · `upload_task_attachment`(base64, owner/admin/special_user 역할 필요)
- **쓰기·라벨/하위(2)**: `create_label` · `update_sub_project`

### 규약

- **ID**: `projectId`/`subProjectId`는 인코딩 문자열(목록 도구의 `id`에서만 획득, 파싱 금지). `stageId`/`labelId`는 raw 정수(`get_project_stages`/`list_labels`에서 획득). `taskNumber`는 프로젝트별 번호.
- **콘텐츠**: `content`/`retrospective`/노트는 **markdown 문자열**로 전달 → 서버에서 에디터 봉투로 저장.
- **에러**: 단일 엔벨로프 `{ error, code, status }`를 그대로 반환(LLM이 `code`로 자가 교정). 4xx는 재시도 금지.
- **마감일** = `expectedEnd`. "마감 없음"은 `dateField=expectedEnd, dateMatch=null`, "기간 내 또는 없음"은 `dateMatch=rangeOrNull`.
