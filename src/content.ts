/**
 * 에디터 콘텐츠 봉투(B2). LLM은 평문/markdown을 항상 이 봉투로 감싸 전송한다.
 * 서버가 plainText는 자동 추출하므로 생략한다.
 */
export interface EditorContentEnvelope {
  version: '1.0';
  editor: 'markdown';
  format: 'markdown';
  data: string;
}

/** markdown 문자열을 toodoori 에디터 콘텐츠 봉투로 감싼다. */
export function markdownEnvelope(markdown: string): EditorContentEnvelope {
  return { version: '1.0', editor: 'markdown', format: 'markdown', data: markdown };
}
