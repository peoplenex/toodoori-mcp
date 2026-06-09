import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToodooriClient, ToodooriApiError } from './client.js';
import { markdownEnvelope } from './content.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}
function fail(e: unknown): ToolResult {
  if (e instanceof ToodooriApiError) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: e.message, code: e.code, status: e.status }, null, 2) }],
      isError: true,
    };
  }
  return { content: [{ type: 'text', text: `예상치 못한 오류: ${(e as Error).message}` }], isError: true };
}
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}
/** undefined 값 제거 (부분 바디 전송용) */
function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
const idem = () => randomUUID();

/** 선행 `~`/`~/`를 홈 디렉터리로 확장한다(셸이 아닌 직접 호출 시 ~는 확장되지 않으므로). */
function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p;
}

// ── 공통 입력 스키마 조각 (ID 계약 B1: 출처/종류 명시) ──
const projectId = z.string().describe('인코딩된 projectId. list_projects의 project.id에서만 얻는다(파싱·생성 금지).');
const taskNumber = z.number().int().describe('프로젝트 내 작업 번호(전역 id 아님). 참조는 projectId#taskNumber.');
const stageId = z.number().int().describe('raw 정수 스테이지 id. get_project_stages/get_project_board에서만 얻는다.');
const subProjectIdStr = z.string().describe('인코딩된 subProjectId. list_sub_projects의 id에서만 얻는다.');

const DATE_FIELDS = [
  'expectedStart',
  'expectedEnd',
  'actualStart',
  'actualEnd',
  'created',
  'updated',
  'archived',
] as const;
const SORT_FIELDS = [
  'created',
  'updated',
  'priority',
  'taskNumber',
  'title',
  'archived',
  'expectedStart',
  'expectedEnd',
  'actualStart',
  'actualEnd',
] as const;
const DATE_MATCH = ['range', 'null', 'notNull', 'rangeOrNull'] as const;

// 텍스트로 디코드해 반환할 MIME (그 외는 바이너리 → 다운로드 URL 반환)
const TEXT_MIME = /^text\/|^application\/(json|xml|x-yaml|yaml|x-ndjson|javascript)\b|\+xml$|\+json$/i;

// 검색 공통 필터(전역/프로젝트별 공유)
const searchCommon = {
  keyword: z.string().optional().describe('제목·내용 키워드(부분 일치)'),
  priorities: z.array(z.number().int()).optional().describe('우선순위 목록(1~5, OR)'),
  labelIds: z.array(z.number().int()).optional().describe('raw labelId 목록(OR). list_labels에서 획득'),
  dateField: z.enum(DATE_FIELDS).optional().describe('날짜 필터 대상(마감일=expectedEnd)'),
  dateFrom: z.string().optional().describe('시작 일시(ISO 8601 date 또는 date-time)'),
  dateTo: z.string().optional().describe('종료 일시(ISO 8601 date 또는 date-time)'),
  dateMatch: z
    .enum(DATE_MATCH)
    .optional()
    .describe('range(기간)/null(마감없음 IS NULL)/notNull(있음)/rangeOrNull(기간 내 또는 없음). dateField와 함께'),
  includeArchived: z.boolean().optional(),
  archivedOnly: z.boolean().optional(),
  includeDeleted: z.boolean().optional(),
  page: z.number().int().optional(),
  limit: z.number().int().optional().describe('페이지당 항목 수(최대 100)'),
  sortBy: z.enum(SORT_FIELDS).optional().describe('정렬 필드(expected*/actual*는 날짜순, NULL은 뒤로)'),
  sortOrder: z.enum(['asc', 'desc']).optional(),
};

export function registerTools(server: McpServer, api: ToodooriClient): void {
  // ════════════ 읽기 ════════════
  server.registerTool(
    'list_projects',
    {
      description: '내 프로젝트 목록. 응답 project.id가 이후 모든 projectId의 유일한 출처.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => run(() => api.get('/projects')),
  );

  server.registerTool(
    'get_project_board',
    {
      description: '프로젝트 보드 전체(workflowGroups→stages→tasks). raw stageId·taskNumber·wgId 확보용.',
      inputSchema: { projectId },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => run(() => api.get(`/projects/${projectId}/details`)),
  );

  server.registerTool(
    'get_project_stages',
    {
      description: '프로젝트의 스테이지(칸반 컬럼) 목록. create_task/move_task에 쓸 raw stageId 확보용.',
      inputSchema: { projectId },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => run(() => api.get(`/projects/${projectId}/stages`)),
  );

  server.registerTool(
    'search_all_tasks',
    {
      description:
        '내 모든 프로젝트를 가로지르는 작업 검색(가장 잦은 조회). 마감 임박/없음(dateMatch=null/rangeOrNull)·키워드·라벨·우선순위. projectIds(인코딩)로 좁히기 가능.',
      inputSchema: {
        ...searchCommon,
        projectIds: z.array(z.string()).optional().describe('좁힐 프로젝트(인코딩 projectId) 목록'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => run(() => api.post('/tasks/search', clean(args))),
  );

  server.registerTool(
    'search_tasks',
    {
      description:
        '한 프로젝트 내 작업 검색/필터. 스테이지(stageId/stageIds)·워크플로 그룹(workflowGroupId|Name)·하위프로젝트(subProjectId, "none"=미분류)·날짜 필터. 응답에 wgId/stageName 포함.',
      inputSchema: {
        projectId,
        ...searchCommon,
        taskNumber: z.number().int().optional().describe('정확 매칭'),
        stageId: z.number().int().optional(),
        stageIds: z.array(z.number().int()).optional().describe('여러 스테이지(OR)'),
        workflowGroupId: z.number().int().optional(),
        workflowGroupName: z.enum(['Backlog', 'Planning', 'Progressing', 'Finished']).optional(),
        subProjectId: z.string().optional().describe('인코딩 subProjectId, 또는 "none"=미분류'),
        parentTaskId: z.number().int().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, ...rest }) => run(() => api.post(`/projects/${projectId}/tasks/search`, clean(rest))),
  );

  server.registerTool(
    'get_task',
    {
      description: '작업 상세(내용·체크리스트·노트·라벨 등 임베드).',
      inputSchema: { projectId, taskNumber },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, taskNumber }) => run(() => api.get(`/projects/${projectId}/tasks/${taskNumber}/full`)),
  );

  server.registerTool(
    'list_labels',
    {
      description: '프로젝트 라벨 목록. 응답 id가 raw labelId(검색/라벨 도구 입력에 사용).',
      inputSchema: { projectId },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId }) => run(() => api.get('/labels', { projectId })),
  );

  server.registerTool(
    'list_sub_projects',
    {
      description: '프로젝트의 하위 프로젝트 목록. 응답 id가 인코딩 subProjectId.',
      inputSchema: { projectId, includeArchived: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, includeArchived }) =>
      run(() => api.get(`/projects/${projectId}/sub-projects`, clean({ includeArchived }))),
  );

  server.registerTool(
    'get_sub_project',
    {
      description: '하위 프로젝트 상세(진행률·content 포함).',
      inputSchema: { subProjectId: subProjectIdStr },
      annotations: { readOnlyHint: true },
    },
    async ({ subProjectId }) => run(() => api.get(`/sub-projects/${subProjectId}`)),
  );

  // ════════════ 쓰기 — 작업 ════════════
  server.registerTool(
    'create_task',
    {
      description: '작업 생성. stageId(raw, 필수)·title 필수. content는 markdown 문자열(서버에서 봉투로 저장).',
      inputSchema: {
        projectId,
        stageId: stageId.describe('대상 스테이지 raw id(필수)'),
        title: z.string().min(1),
        content: z.string().optional().describe('본문(markdown)'),
        priority: z.number().int().min(1).max(5).optional().describe('1~5 (기본 3)'),
        labels: z.array(z.number().int()).optional().describe('raw labelId 목록'),
        subProjectId: z.string().nullable().optional().describe('인코딩 subProjectId 또는 null'),
        parentTaskId: z.number().int().optional().describe('상위 작업의 전역 tasks.id(드묾)'),
        expectedStartAt: z.string().optional().describe('시작 예정(ISO 8601)'),
        expectedEndAt: z.string().optional().describe('마감 예정(ISO 8601)'),
      },
    },
    async ({ projectId, content, ...rest }) =>
      run(() =>
        api.post(
          `/projects/${projectId}/tasks`,
          clean({ ...rest, content: content ? markdownEnvelope(content) : undefined }),
          {
            idempotencyKey: idem(),
          },
        ),
      ),
  );

  server.registerTool(
    'update_task',
    {
      description: '작업 부분 수정(생략=유지, null=비움). content/retrospective는 markdown, labels는 전체 교체.',
      inputSchema: {
        projectId,
        taskNumber,
        title: z.string().min(1).optional(),
        content: z.string().nullable().optional().describe('본문(markdown), null=비움'),
        retrospective: z.string().nullable().optional().describe('회고(markdown), null=비움'),
        priority: z.number().int().min(1).max(5).optional(),
        stageId: z.number().int().optional(),
        subProjectId: z.string().nullable().optional(),
        labels: z.array(z.number().int()).optional().describe('전체 교체'),
        expectedStartAt: z.string().nullable().optional(),
        expectedEndAt: z.string().nullable().optional(),
        actualStartAt: z.string().nullable().optional(),
        actualEndAt: z.string().nullable().optional(),
      },
    },
    async ({ projectId, taskNumber, content, retrospective, ...rest }) =>
      run(() =>
        api.put(
          `/projects/${projectId}/tasks/${taskNumber}`,
          clean({
            ...rest,
            content: content === undefined ? undefined : content === null ? null : markdownEnvelope(content),
            retrospective:
              retrospective === undefined ? undefined : retrospective === null ? null : markdownEnvelope(retrospective),
          }),
          { idempotencyKey: idem() },
        ),
      ),
  );

  server.registerTool(
    'move_task',
    {
      description:
        '작업을 다른 스테이지로 이동. 소프트 WIP 초과는 진행+경고, 하드 초과는 400 WIP.LIMIT_EXCEEDED로 차단.',
      inputSchema: { projectId, taskNumber, stageId: stageId.describe('목적지 스테이지 raw id') },
    },
    async ({ projectId, taskNumber, stageId }) =>
      run(() => api.put(`/projects/${projectId}/tasks/${taskNumber}/move`, { stageId }, { idempotencyKey: idem() })),
  );

  server.registerTool(
    'move_tasks',
    {
      description: '여러 작업을 한 스테이지로 일괄 이동(최대 100).',
      inputSchema: {
        projectId,
        taskNumbers: z.array(z.number().int()).max(100).describe('이동할 작업 번호들(최대 100)'),
        targetStageId: stageId.describe('목적지 스테이지 raw id'),
      },
    },
    async ({ projectId, taskNumbers, targetStageId }) =>
      run(() =>
        api.post(`/projects/${projectId}/tasks/bulk-move`, { taskNumbers, targetStageId }, { idempotencyKey: idem() }),
      ),
  );

  server.registerTool(
    'update_task_labels',
    {
      description: '작업 라벨 증분 수정(add/remove). 안전한 부분 변경.',
      inputSchema: {
        projectId,
        taskNumber,
        add: z.array(z.number().int()).optional().describe('추가할 raw labelId'),
        remove: z.array(z.number().int()).optional().describe('제거할 raw labelId'),
      },
    },
    async ({ projectId, taskNumber, add, remove }) =>
      run(() => api.patch(`/projects/${projectId}/tasks/${taskNumber}/labels`, clean({ add, remove }))),
  );

  server.registerTool(
    'archive_task',
    {
      description: '작업 보관(가역 — unarchive 가능).',
      inputSchema: { projectId, taskNumber },
    },
    async ({ projectId, taskNumber }) =>
      run(() => api.post(`/projects/${projectId}/tasks/${taskNumber}/archive`, undefined, { idempotencyKey: idem() })),
  );

  server.registerTool(
    'archive_tasks',
    {
      description: '여러 작업 일괄 보관(최대 100). 이미 보관/삭제분은 무시.',
      inputSchema: { projectId, taskNumbers: z.array(z.number().int()).max(100) },
    },
    async ({ projectId, taskNumbers }) =>
      run(() => api.post(`/projects/${projectId}/tasks/bulk-archive`, { taskNumbers }, { idempotencyKey: idem() })),
  );

  server.registerTool(
    'delete_task',
    {
      description: '작업 소프트 삭제(restore 가능). 사용자 확인 후 호출 권장.',
      inputSchema: { projectId, taskNumber },
      annotations: { destructiveHint: true },
    },
    async ({ projectId, taskNumber }) => run(() => api.delete(`/projects/${projectId}/tasks/${taskNumber}`)),
  );

  server.registerTool(
    'create_checklist_item',
    {
      description: '작업에 체크리스트 항목 추가.',
      inputSchema: {
        projectId,
        taskNumber,
        title: z.string().min(1).max(255),
        dueDate: z.string().optional().describe('마감(ISO 8601, 선택)'),
      },
    },
    async ({ projectId, taskNumber, title, dueDate }) =>
      run(() => api.post(`/projects/${projectId}/tasks/${taskNumber}/checklists`, clean({ title, dueDate }))),
  );

  server.registerTool(
    'update_checklist_item',
    {
      description: '체크리스트 항목 수정(완료 토글·제목·마감).',
      inputSchema: {
        projectId,
        taskNumber,
        itemId: z.number().int().describe('raw 체크리스트 항목 id(get_task 응답에 임베드)'),
        title: z.string().min(1).max(255).optional(),
        isCompleted: z.boolean().optional(),
        dueDate: z.string().nullable().optional().describe('null=비움'),
      },
    },
    async ({ projectId, taskNumber, itemId, ...rest }) =>
      run(() => api.put(`/projects/${projectId}/tasks/${taskNumber}/checklists/${itemId}`, clean(rest))),
  );

  server.registerTool(
    'create_task_note',
    {
      description: '작업에 노트 추가. content는 markdown.',
      inputSchema: { projectId, taskNumber, content: z.string().min(1).describe('노트 본문(markdown)') },
    },
    async ({ projectId, taskNumber, content }) =>
      run(() => api.post(`/projects/${projectId}/tasks/${taskNumber}/notes`, { content: markdownEnvelope(content) })),
  );

  server.registerTool(
    'upload_task_attachment',
    {
      description:
        '작업에 파일 첨부. content(텍스트/markdown 내용을 직접) 또는 filePath(로컬 파일 경로) 중 정확히 하나로 전달한다 — base64 인코딩 불필요. 서버에서 ≤10MB, 실행/위험 확장자 차단, MIME 자동 감지. ※ PAT 사용자 역할이 owner/admin/special_user여야 함(아니면 403).',
      inputSchema: {
        projectId,
        taskNumber,
        content: z
          .string()
          .min(1)
          .optional()
          .describe('파일로 저장할 텍스트/markdown 내용을 그대로 전달. filePath와 둘 중 하나만.'),
        filePath: z
          .string()
          .min(1)
          .optional()
          .describe('업로드할 로컬 파일 경로(바이너리 포함, ~ 확장 지원). content와 둘 중 하나만.'),
        originalName: z
          .string()
          .min(1)
          .optional()
          .describe('원본 파일명(확장자 포함). content 사용 시 필수, filePath 사용 시 생략하면 경로의 파일명을 사용.'),
        mimeType: z.string().optional().describe('클라이언트 MIME(선택, 서버가 magic-byte/확장자로 우선 감지).'),
      },
    },
    async ({ projectId, taskNumber, content, filePath, originalName, mimeType }) =>
      run(async () => {
        // content | filePath 중 정확히 하나 (XOR)
        if ((content === undefined) === (filePath === undefined)) {
          throw new ToodooriApiError(400, 'VALIDATION_ERROR', 'content 또는 filePath 중 정확히 하나를 전달하세요.');
        }

        let bytes: Uint8Array;
        let name: string | undefined = originalName;

        if (content !== undefined) {
          if (!name) {
            throw new ToodooriApiError(400, 'VALIDATION_ERROR', 'content 사용 시 originalName(확장자 포함)이 필요합니다.');
          }
          bytes = Buffer.from(content, 'utf8');
        } else {
          const resolved = expandHome(filePath!);
          try {
            bytes = await readFile(resolved);
          } catch (err) {
            throw new ToodooriApiError(400, 'FILE_READ_ERROR', `파일을 읽을 수 없습니다(${resolved}): ${(err as Error).message}`);
          }
          name = name ?? basename(resolved);
        }

        return api.postFile(`/projects/${projectId}/tasks/${taskNumber}/attachments`, { bytes, filename: name!, mimeType });
      }),
  );

  server.registerTool(
    'read_attachment',
    {
      description:
        '작업 첨부 읽기. text/* 등 텍스트 파일은 내용을 그대로 반환(LLM이 읽음), 바이너리는 다운로드 URL을 반환. attachmentId는 get_task 응답의 attachments[].id.',
      inputSchema: {
        projectId,
        taskNumber,
        attachmentId: z.number().int().describe('raw 첨부 id (get_task의 attachments[].id)'),
        maxChars: z.number().int().optional().describe('텍스트 최대 반환 길이(기본 200000)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ projectId, taskNumber, attachmentId, maxChars }) =>
      run(async () => {
        const base = `/projects/${projectId}/tasks/${taskNumber}/attachments`;
        const list = await api.get<unknown>(base);
        const arr = Array.isArray(list)
          ? (list as Array<{ id: number; originalName?: string; mimeType?: string; fileSize?: number }>)
          : [];
        const meta = arr.find((a) => a.id === attachmentId);
        if (!meta) {
          throw new ToodooriApiError(404, 'ATTACHMENT_NOT_FOUND', `첨부 ${attachmentId}를 찾을 수 없습니다.`);
        }
        const mime = meta.mimeType || 'application/octet-stream';
        if (TEXT_MIME.test(mime)) {
          const { bytes } = await api.downloadRaw(`${base}/${attachmentId}/download`);
          const limit = maxChars ?? 200000;
          const full = Buffer.from(bytes).toString('utf8');
          return {
            id: attachmentId,
            originalName: meta.originalName,
            mimeType: mime,
            fileSize: meta.fileSize,
            truncated: full.length > limit,
            text: full.slice(0, limit),
          };
        }
        const download = await api.get(`${base}/${attachmentId}/url`);
        return {
          id: attachmentId,
          originalName: meta.originalName,
          mimeType: mime,
          fileSize: meta.fileSize,
          note: '바이너리 파일 — 텍스트 미반환. download URL로 받으세요.',
          download,
        };
      }),
  );

  // ════════════ 쓰기 — 라벨 / 하위 프로젝트 ════════════
  server.registerTool(
    'create_label',
    {
      description: '프로젝트 라벨 생성. name은 프로젝트 내 유일(중복 409), color는 #RRGGBB.',
      inputSchema: {
        projectId,
        name: z.string().min(1),
        color: z.string().optional().describe('#RRGGBB'),
      },
    },
    async ({ projectId, name, color }) => run(() => api.post('/labels', clean({ projectId, name, color }))),
  );

  server.registerTool(
    'update_sub_project',
    {
      description: '하위 프로젝트 부분 수정. content/retrospective는 markdown. status=active|paused|completed.',
      inputSchema: {
        subProjectId: subProjectIdStr,
        name: z.string().min(1).optional(),
        emoji: z.string().optional(),
        color: z.string().optional().describe('#RRGGBB'),
        description: z.string().nullable().optional(),
        status: z.enum(['active', 'paused', 'completed']).optional(),
        content: z.string().nullable().optional().describe('markdown, null=비움'),
        retrospective: z.string().nullable().optional().describe('markdown, null=비움'),
        sortOrder: z.number().int().optional(),
      },
    },
    async ({ subProjectId, content, retrospective, ...rest }) =>
      run(() =>
        api.patch(
          `/sub-projects/${subProjectId}`,
          clean({
            ...rest,
            content: content === undefined ? undefined : content === null ? null : markdownEnvelope(content),
            retrospective:
              retrospective === undefined ? undefined : retrospective === null ? null : markdownEnvelope(retrospective),
          }),
        ),
      ),
  );
}
