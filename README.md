# @peoplenexteam/toodoori-mcp

LLM(Claude 등)이 toodoori 할 일 관리를 수행하도록, 기존 `/api/v1`를 감싸는 **얇은 stdio MCP 서버**입니다.
인가 로직을 새로 만들지 않고 PAT를 달아 toodoori 서버의 가드 체인을 그대로 거칩니다.

## 환경변수

- `TOODOORI_PAT` (필수): 개인 액세스 토큰 `tdr_pat_...`. toodoori 설정 → PAT 발급에서 생성.
- `TOODOORI_API_BASE`: API 베이스 URL. **`https://api.toodoori.com` 로 지정하세요** (미지정 시 동작하지 않습니다).

## 설치 — 일반 사용자 (npx, 운영)

별도 클론/빌드 없이 `npx`로 실행합니다.

1. **PAT 발급**: toodoori.com 로그인 → 설정 → 개인 액세스 토큰 발급(필요한 스코프만). 토큰은 **1회만 표시**되니 안전히 보관.
2. **MCP 클라이언트 등록**

Claude Desktop (`claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "toodoori": {
      "command": "npx",
      "args": ["-y", "@peoplenexteam/toodoori-mcp"],
      "env": {
        "TOODOORI_PAT": "tdr_pat_...",
        "TOODOORI_API_BASE": "https://api.toodoori.com",
      },
    },
  },
}
```

Claude Code:

```bash
claude mcp add --env TOODOORI_PAT=tdr_pat_... --env TOODOORI_API_BASE=https://api.toodoori.com --transport stdio toodoori -- npx -y @peoplenexteam/toodoori-mcp
```

## 도구 (24개)

- **읽기(10)**: `list_projects` · `get_project_board` · `get_project_stages` · `search_all_tasks`(전역) · `search_tasks`(프로젝트) · `get_task` · `list_labels` · `list_sub_projects` · `get_sub_project` · `read_attachment`(텍스트는 내용, 바이너리는 다운로드 URL)
- **쓰기·작업(12)**: `create_task` · `update_task` · `move_task` · `move_tasks` · `update_task_labels` · `archive_task` · `archive_tasks` · `delete_task` · `create_checklist_item` · `update_checklist_item` · `create_task_note` · `upload_task_attachment`(base64, 첨부 권한 필요)
- **쓰기·라벨/하위(2)**: `create_label` · `update_sub_project`

### 규약

- **ID**: `projectId`/`subProjectId`는 인코딩 문자열(목록 도구의 `id`에서만 획득, 파싱 금지). `stageId`/`labelId`는 raw 정수(`get_project_stages`/`list_labels`에서 획득). `taskNumber`는 프로젝트별 번호.
- **콘텐츠**: `content`/`retrospective`/노트는 **markdown 문자열**로 전달합니다.
- **에러**: 단일 엔벨로프 `{ error, code, status }`를 그대로 반환(LLM이 `code`로 자가 교정). 4xx는 재시도 금지.
- **마감일** = `expectedEnd`. "마감 없음"은 `dateField=expectedEnd, dateMatch=null`, "기간 내 또는 없음"은 `dateMatch=rangeOrNull`.
