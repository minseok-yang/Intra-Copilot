// 모델 답변을 새 노트로 바꾸는 규칙만 모아 둔 곳입니다. Obsidian API를 쓰지 않아 test/generator.test.ts에서
// 그대로 돌려볼 수 있습니다(실제 파일을 만드는 곳은 generator/generate.ts).
//
// 규칙
// - 제목: 모델은 첫 줄에 "제목: ..." 한 줄을 씁니다. 그 줄은 노트 본문에서 빼고 파일 이름으로 씁니다.
//   모델이 형식을 틀려 제목 줄이 없으면 첫 제목(# ...)을, 그것도 없으면 정해 둔 이름을 씁니다.
// - 속성(맨 위 --- 사이): 양식에 있는 키만 남깁니다. 모델이 없던 속성(예: aliases, status)을 지어내도
//   노트에 들어가지 않습니다. 값이 빈 키는 플러그인이 아는 값(작성일 등)으로 채웁니다.
// - 속성 YAML이 깨져 있어도 노트를 버리지 않습니다 — 읽을 수 있는 부분만 손대고 나머지는 그대로 둡니다
//   (사용자가 노트를 열어 고칠 수 있게. 결정 14 "YAML이 깨지면 노트를 버리지 말고 결과를 보여 줌").

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// YAML 맨 앞 칸(들여쓰기 없음)에서 시작하는 "키:" 줄. 들여쓴 줄과 '- ' 줄은 위 키에 딸린 값입니다.
const KEY_LINE = /^([^\s:#][^:]*):[ \t]*(.*)$/;

export interface SplitNote {
	frontmatter: string | null; // --- 사이의 내용(--- 줄은 빼고). 속성이 없으면 null
	body: string;
}

export function splitFrontmatter(text: string): SplitNote {
	const match = FRONTMATTER.exec(text);
	if (!match) return { frontmatter: null, body: text };
	return { frontmatter: match[1] ?? '', body: text.slice(match[0].length) };
}

// 속성에 있는 키 이름을 적힌 순서대로 돌려줍니다(양식에서 "허용할 키" 목록을 만들 때 씁니다).
export function frontmatterKeys(frontmatter: string): string[] {
	const keys: string[] = [];
	for (const line of frontmatter.split(/\r?\n/)) {
		const key = KEY_LINE.exec(line)?.[1]?.trim();
		if (key) keys.push(key);
	}
	return keys;
}

export interface FilteredFrontmatter {
	text: string; // 남은 속성(--- 줄은 빼고). 남은 키가 없으면 ''
	dropped: string[]; // 양식에 없어서 뺀 키
}

// 양식에 있는 키만 남기고, 값이 빈 키는 fills의 값으로 채웁니다. 키 이름의 대소문자는 가리지 않습니다.
export function filterFrontmatter(
	frontmatter: string,
	allowedKeys: readonly string[],
	fills: Readonly<Record<string, string>> = {},
): FilteredFrontmatter {
	const allowed = new Set(allowedKeys.map((key) => key.toLowerCase()));
	const kept: string[] = [];
	const dropped: string[] = [];
	// 키 줄을 만나면 그 키를 남길지 정하고, 뒤따르는 들여쓴 줄·'- ' 줄은 그 결정을 함께 따릅니다.
	let keepingBlock = true;
	for (const line of frontmatter.split(/\r?\n/)) {
		const match = KEY_LINE.exec(line);
		if (!match) {
			if (keepingBlock) kept.push(line);
			continue;
		}
		const key = (match[1] ?? '').trim();
		const value = (match[2] ?? '').trim();
		keepingBlock = allowed.has(key.toLowerCase());
		if (!keepingBlock) {
			dropped.push(key);
			continue;
		}
		const fill = fills[key];
		kept.push(!value && fill ? `${key}: ${fill}` : line);
	}
	// 값이 딸린 줄만 남고 키가 다 빠지면 빈 속성이 되므로, 그때는 아예 넣지 않습니다.
	const text = kept.join('\n').trim();
	return { text: frontmatterKeys(text).length > 0 ? text : '', dropped };
}

// 모델이 답변 전체를 코드펜스로 감쌌으면 걷어냅니다(닫는 펜스를 빼먹은 경우도 함께).
function stripWrappingFence(text: string): string {
	const lines = text.trim().split(/\r?\n/);
	if (!/^\s*```/.test(lines[0] ?? '')) return text.trim();
	lines.shift();
	if (/^\s*```\s*$/.test(lines[lines.length - 1] ?? '')) lines.pop();
	return lines.join('\n').trim();
}

// "제목: 회의록 정리" 한 줄. 모델이 **제목**: 이나 # 제목: 처럼 꾸며 써도 읽습니다
// (제목 값에 붙은 굵게 표시 **…**는 아래에서 걷어냅니다).
const TITLE_LINE = /^[\s>#*_-]*제목[\s*_]*[:：]\s*(.+)$/;
const DECORATION = /^[*_\s]+|[*_\s]+$/g;
const HEADING_LINE = /^#{1,6}\s+(.+?)\s*$/;

// 파일 이름에 쓸 수 없는 글자를 뺍니다(Obsidian은 [ ] # ^ | 도 링크 문법과 겹쳐 싫어합니다).
export function safeFileName(title: string, fallback: string): string {
	const cleaned = title
		.replace(/[\\/:*?"<>|#^[\]]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^\.+/, '')
		.trim()
		.slice(0, 80)
		.trim();
	return cleaned || fallback;
}

export interface BuiltNote {
	title: string; // 파일 이름으로 쓸 제목(확장자 없음)
	content: string; // 노트에 쓸 내용
	droppedKeys: string[]; // 양식에 없어서 뺀 속성 키
	titleFromModel: boolean; // 모델이 "제목:" 줄을 제대로 썼는지(아니면 제목을 우리가 정한 것)
}

export function buildNote(
	raw: string,
	options: {
		templateText: string; // 양식 노트의 내용(여기 있는 속성 키만 남깁니다)
		fills?: Readonly<Record<string, string>>; // 값이 빈 속성에 채울 값(예: created → 오늘 날짜)
		fallbackTitle: string; // 모델이 제목을 안 줬을 때 쓸 이름
	},
): BuiltNote {
	const lines = stripWrappingFence(raw).split(/\r?\n/);

	// 제목 줄은 답변 맨 앞에 있습니다. 모델이 인사말을 한 줄 붙이는 경우가 있어 앞쪽 몇 줄만 봅니다.
	let title = '';
	for (let i = 0; i < Math.min(lines.length, 5); i++) {
		const found = TITLE_LINE.exec(lines[i] ?? '')?.[1];
		if (!found) continue;
		title = found.replace(DECORATION, '');
		lines.splice(i, 1);
		break;
	}
	const titleFromModel = title !== '';
	if (!titleFromModel) {
		for (const line of lines) {
			const heading = HEADING_LINE.exec(line)?.[1];
			if (heading) {
				title = heading;
				break;
			}
		}
	}

	const { frontmatter, body } = splitFrontmatter(lines.join('\n').trim());
	const allowedKeys = frontmatterKeys(splitFrontmatter(options.templateText).frontmatter ?? '');
	const filtered =
		frontmatter === null
			? { text: '', dropped: [] as string[] }
			: filterFrontmatter(frontmatter, allowedKeys, options.fills);

	const content = `${filtered.text ? `---\n${filtered.text}\n---\n\n` : ''}${body.trim()}\n`;
	return {
		title: safeFileName(title, options.fallbackTitle),
		content,
		droppedKeys: filtered.dropped,
		titleFromModel,
	};
}
