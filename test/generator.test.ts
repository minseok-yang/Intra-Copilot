// 제너레이터가 모델 답변을 새 노트로 바꾸는 규칙(src/generator/note-build.ts) 테스트입니다.
// 실제 파일을 만들지 않고 글자만 다루는 부분이라 Obsidian 없이 그대로 돌아갑니다(npm test).
import assert from 'node:assert/strict';
import { TFile } from 'obsidian';
import { buildNote, filterFrontmatter, frontmatterKeys, safeFileName, splitFrontmatter } from '../src/generator/note-build';
import { listTemplates } from '../src/generator/templates';

let passed = 0;
function test(name: string, run: () => void): void {
	run();
	passed++;
	console.log(`  ✓ ${name}`);
}

const TEMPLATE = `---
created:
tags: [회의]
---

# (회의 제목)

## 결정 사항
- (정해진 것)
`;

const build = (raw: string, templateText = TEMPLATE) =>
	buildNote(raw, { templateText, fills: { created: '2026-09-16' }, fallbackTitle: '제목 없는 노트' });

test('제목 줄을 파일 이름으로 쓰고 본문에서 뺀다', () => {
	const note = build('제목: 9월 정기 회의\n\n# 9월 정기 회의\n\n내용');
	assert.equal(note.title, '9월 정기 회의');
	assert.equal(note.titleFromModel, true);
	assert.ok(!note.content.includes('제목: 9월 정기 회의'));
	assert.ok(note.content.includes('# 9월 정기 회의'));
});

test('모델이 제목 줄을 꾸며 써도 읽는다', () => {
	assert.equal(build('**제목**: 예산 검토\n\n본문').title, '예산 검토');
	assert.equal(build('## 제목 ： 예산 검토\n\n본문').title, '예산 검토');
});

test('제목 줄이 없으면 첫 제목을, 그것도 없으면 정해 둔 이름을 쓴다', () => {
	const heading = build('## 8월 실적 정리\n\n내용');
	assert.equal(heading.title, '8월 실적 정리');
	assert.equal(heading.titleFromModel, false);
	assert.equal(build('제목 없이 본문만 있는 답변').title, '제목 없는 노트');
});

test('답변 전체를 코드펜스로 감싸면 걷어낸다(닫는 펜스가 없어도)', () => {
	const fenced = build('```markdown\n제목: 감싼 답변\n\n본문\n```');
	assert.equal(fenced.title, '감싼 답변');
	assert.ok(!fenced.content.includes('```'));
	assert.ok(!build('```\n제목: 안 닫힘\n\n본문').content.includes('```'));
});

test('양식에 없는 속성은 빼고, 어떤 키를 뺐는지 알려준다', () => {
	const note = build('제목: 회의\n---\ncreated: 2026-09-01\nstatus: draft\naliases: [별명]\ntags: [회의]\n---\n\n본문');
	assert.ok(note.content.startsWith('---\ncreated: 2026-09-01\ntags: [회의]\n---\n'));
	assert.deepEqual(note.droppedKeys, ['status', 'aliases']);
});

test('양식에 있는 속성이 비어 있으면 플러그인이 채운다', () => {
	const note = build('제목: 회의\n---\ncreated:\ntags: [회의]\n---\n\n본문');
	assert.ok(note.content.includes('created: 2026-09-16'));
});

test('양식에 속성이 없으면 모델이 붙인 속성을 모두 뺀다', () => {
	const note = build('제목: 메모\n---\nstatus: draft\n---\n\n본문', '# (제목)\n\n본문\n');
	assert.ok(!note.content.includes('---'));
	assert.deepEqual(note.droppedKeys, ['status']);
});

test('속성 키의 대소문자가 달라도 빈 값을 채운다', () => {
	const filled = filterFrontmatter('Created:', ['created'], { created: '2026-09-16' });
	assert.equal(filled.text, 'Created: 2026-09-16');
});

test('여러 줄로 적힌 속성 값은 그 키의 결정을 함께 따른다', () => {
	const kept = filterFrontmatter('tags:\n  - 회의\n  - 예산\nstatus:\n  - draft', ['tags']);
	assert.equal(kept.text, 'tags:\n  - 회의\n  - 예산');
	assert.deepEqual(kept.dropped, ['status']);
});

test('속성 YAML이 깨져 있어도 노트를 버리지 않는다', () => {
	const note = build('제목: 깨진 속성\n---\ncreated: 2026-09-01\n  이상한 줄\n---\n\n본문');
	assert.ok(note.content.includes('created: 2026-09-01'));
	assert.ok(note.content.includes('본문'));
});

test('속성 구역을 나누고 키를 순서대로 읽는다', () => {
	const split = splitFrontmatter('---\na: 1\nb: 2\n---\n\n본문');
	assert.equal(split.body.trim(), '본문');
	assert.deepEqual(frontmatterKeys(split.frontmatter ?? ''), ['a', 'b']);
	assert.equal(splitFrontmatter('본문만').frontmatter, null);
});

test('파일 이름에 쓸 수 없는 글자를 뺀다', () => {
	assert.equal(safeFileName('보고서: 9/16 회의 [초안]', '대체'), '보고서 916 회의 초안');
	assert.equal(safeFileName('   ', '대체'), '대체');
	assert.equal(safeFileName('...숨김', '대체'), '숨김');
	assert.equal(safeFileName('가'.repeat(100), '대체').length, 80);
});

// ─── 양식 목록(src/generator/templates.ts) ────────────────────────────
// 볼트에서 노트 목록만 읽는 부분이라, 파일 목록을 돌려주는 가짜 볼트 하나로 확인할 수 있습니다.
const templateList = (paths: string[], folders: { templateFolder: string; outputFolder: string }) => {
	const files = paths.map((path) => new TFile(path, 0));
	const plugin = {
		app: { vault: { getMarkdownFiles: () => files } },
		settings: { generator: folders },
	} as unknown as Parameters<typeof listTemplates>[0];
	return listTemplates(plugin);
};

test('양식 목록은 양식 폴더 안만 보고, 저장 폴더가 그 안에 있으면 뺀다', () => {
	const list = templateList(
		['Generator/회의록.md', 'Generator/보고/주간.md', 'Generator/받은 노트/만든 노트.md', '다른 폴더/메모.md'],
		{ templateFolder: 'Generator', outputFolder: 'Generator/받은 노트' },
	);
	assert.deepEqual(
		list.map((template) => template.file.path),
		['Generator/보고/주간.md', 'Generator/회의록.md'],
	);
});

test('하위 폴더에 이름이 같은 양식이 둘 있으면 폴더까지 보여 준다', () => {
	const list = templateList(['Generator/회의록.md', 'Generator/영업/회의록.md', 'Generator/주간.md'], {
		templateFolder: 'Generator',
		outputFolder: 'Generator-inbox',
	});
	assert.deepEqual(
		list.map((template) => template.name),
		['영업/회의록', '주간', '회의록'],
	);
});

console.log(`\n${passed} passed`);
