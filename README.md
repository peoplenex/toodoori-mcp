# @peoplenexteam/toodoori-mcp

LLM(Claude 등)이 toodoori 할 일 관리를 수행하도록, 기존 `/api/v1`를 감싸는 **얇은 stdio MCP 서버**입니다.
인가 로직을 새로 만들지 않고 PAT를 달아 서버 가드 체인을 그대로 거칩니다(설계: [`../docs/ai-integration/mcp-design.md`](../docs/ai-integration/mcp-design.md)).

## 환경변수

- `TOODOORI_PAT` (필수): 개인 액세스 토큰 `tdr_pat_...`. toodoori 설정 → PAT 발급에서 생성.
- `TOODOORI_API_BASE` (선택): API 베이스. 기본 `http://localhost:3100`(로컬 dev). **운영은 반드시 `https://api.toodoori.com`로 지정.**
  - ⚠️ PAT는 **발급한 환경에서만** 유효(로컬↔운영 분리). base와 PAT의 환경을 맞추세요.

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

## 로컬 개발 (소스에서 직접 실행)

이 레포에서 개발/디버깅할 때:

```bash
yarn install
yarn build          # tsc → dist/
```

등록 시 `command: "node"`, `args: ["<절대경로>/mcp/dist/index.js"]`, `env.TOODOORI_API_BASE: "http://localhost:3100"` (dev 서버 `yarn dev` 필요).

## 도구 (24개)

- **읽기(10)**: `list_projects` · `get_project_board` · `get_project_stages` · `search_all_tasks`(전역) · `search_tasks`(프로젝트) · `get_task` · `list_labels` · `list_sub_projects` · `get_sub_project` · `read_attachment`(텍스트는 내용, 바이너리는 다운로드 URL)
- **쓰기·작업(12)**: `create_task` · `update_task` · `move_task` · `move_tasks` · `update_task_labels` · `archive_task` · `archive_tasks` · `delete_task` · `create_checklist_item` · `update_checklist_item` · `create_task_note` · `upload_task_attachment`(base64, owner/admin/special_user 역할 필요)
- **쓰기·라벨/하위(2)**: `create_label` · `update_sub_project`

### 규약

- **ID**: `projectId`/`subProjectId`는 인코딩 문자열(목록 도구의 `id`에서만 획득, 파싱 금지). `stageId`/`labelId`는 raw 정수(`get_project_stages`/`list_labels`에서 획득). `taskNumber`는 프로젝트별 번호.
- **콘텐츠**: `content`/`retrospective`/노트는 **markdown 문자열**로 전달 → 서버에서 에디터 봉투로 저장.
- **에러**: 단일 엔벨로프 `{ error, code, status }`를 그대로 반환(LLM이 `code`로 자가 교정). 4xx는 재시도 금지.
- **마감일** = `expectedEnd`. "마감 없음"은 `dateField=expectedEnd, dateMatch=null`, "기간 내 또는 없음"은 `dateMatch=rangeOrNull`.

## 배포 (npm publish)

```bash
yarn build                # prepublishOnly에서도 자동 실행됨
npm login                 # @peoplenexteam 조직에 접근 가능한 계정
npm publish               # publishConfig.access=public (스코프 공개 패키지)
```

- `@peoplenexteam` npm 조직 멤버여야 합니다(조직 생성됨). 패키지명 `@peoplenexteam/toodoori-mcp`.
- 버전 갱신: `npm version patch|minor` → `npm publish`.
- `files: ["dist","README.md"]`로 `dist`만 게시됩니다(소스/테스트 제외).
- `license`는 현재 `MIT` — 조직 정책에 맞게 변경하세요.
