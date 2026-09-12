import { App } from 'obsidian';

// 챗봇 답변 속 "노트 수정 제안"을 찾아내고, 노트의 어디를 고칠지 대조하고, 실제로 고치는 곳입니다.
//
// 흐름: 모델이 정해진 형식으로 수정안을 답합니다 → splitAnswer()가 답변을 [글, 제안, 글…]로 나눕니다
//       → checkProposal()이 노트에서 그 원문을 찾습니다 → 사용자가 [적용]을 누르면 applyProposal().
//
// 왜 노트 전체가 아니라 고칠 부분만 받는가: 노트 전체를 다시 쓰게 하면 긴 노트에서 답변 길이 제한에
// 걸려 중간에 잘리고, 사내 공용 서버에 보내는 양도 커집니다. 대신 "원문을 정확히 옮겨 적어야 한다"는
// 부담이 모델에 생기므로, 못 찾은 제안은 적용 버튼을 잠그고 그 이유를 보여줍니다(함부로 고치지 않는 것이
// 이 기능의 목적이므로, 애매하면 적용하지 않는 쪽을 택합니다).

// ─── 답변에서 제안 찾아내기 ──────────────────────────────────────

export interface EditProposal {
	path: string; // 볼트 기준 노트 경로
	before: string; // 노트에서 찾을 원문(비어 있으면 "노트 끝에 덧붙이기")
	after: string; // 그 자리에 넣을 새 글(비어 있으면 "그 부분을 지우기")
	// 왜 이렇게 고치려 하는지. 승인하기 전에 근거를 볼 수 있게 카드에 함께 보여줍니다.
	// 모델이 빠뜨릴 수 있으므로 없을 수도 있습니다(그때는 이유 줄 없이 그립니다).
	reason?: string;
}

export type AnswerPart =
	| { kind: 'text'; text: string }
	| { kind: 'proposal'; proposal: EditProposal; index: number };

// 모델에게 지시하는 형식입니다. 마커는 각자 한 줄을 통째로 차지하므로 노트 내용과 헷갈릴 일이 거의 없고,
// 코드블록(```)을 쓰지 않아서 노트 안에 코드가 들어 있어도 형식이 깨지지 않습니다.
//
//   <<<수정: 프로젝트/회의록.md>>>
//   <<<이유>>>
//   회의에서 김영수 님이 맡기로 한 내용이 본문에 있어 담당자 줄에 반영합니다.
//   <<<이전>>>
//   - 담당자 미정
//   <<<이후>>>
//   - 담당자: 김영수
//   <<<수정 끝>>>
//
// <<<이유>>>는 없어도 됩니다(모델이 빠뜨리면 이유 없이 카드를 그립니다).
//
// 마커를 너그럽게 읽습니다. 꺾쇠는 2개 이상이면 되고, 마커 안팎의 띄어쓰기도 무시합니다.
// (실제 테스트에서 모델이 <<<이전>>> 을 <<<이전>> 으로 — 닫는 꺾쇠를 하나 빠뜨려 적었습니다.
//  형식을 조금 틀렸다고 카드가 통째로 사라지면 사용자는 왜 [적용] 버튼이 없는지 알 수 없으므로,
//  알아볼 수 있는 형태는 최대한 받아들입니다.)
const OPEN = '[ \\t]*<{2,}[ \\t]*';
const CLOSE = '[ \\t]*>{2,}[ \\t]*';
const NEWLINE = '\\r?\\n';

const PROPOSAL_PATTERN = new RegExp(
	`^${OPEN}수정[ \\t]*:[ \\t]*(.+?)${CLOSE}${NEWLINE}` + // <<<수정: 노트/경로.md>>>
		`(?:${OPEN}이유${CLOSE}${NEWLINE}([\\s\\S]*?)\\r?\\n?)?` + // <<<이유>>> + 근거(없어도 됨)
		`${OPEN}이전${CLOSE}${NEWLINE}` + // <<<이전>>>
		`([\\s\\S]*?)\\r?\\n?` + // 노트에서 찾을 원문
		`${OPEN}이후${CLOSE}${NEWLINE}` + // <<<이후>>>
		`([\\s\\S]*?)\\r?\\n?` + // 그 자리에 넣을 새 글
		`${OPEN}수정[ \\t]*끝${CLOSE}$`, // <<<수정 끝>>>
	'gm',
);

// 형식을 알아보지 못한 "수정" 마커가 답변에 남아 있는지 확인합니다(위 형식을 크게 벗어난 경우).
// 남아 있으면 화면에 "형식이 어긋나 적용 버튼을 만들지 못했다"고 알려서, 사용자가 마커 글자만
// 보며 영문을 모르는 일이 없게 합니다.
const LEFTOVER_MARKER = /<{2,}[ \t]*수정[ \t]*[:끝]/;

// 모델이 제안을 코드블록으로 감싸는 경우가 있어, 제안 앞뒤에 홀로 남은 ``` 줄은 글에서 빼 둡니다
// (그대로 두면 답변 화면에 빈 코드블록이 생깁니다).
// 앞쪽: 제안을 여는 ```(언어 이름이 붙어 있을 수 있습니다)
const LONE_FENCE_TAIL = /(?:^|\n)[ \t]*(?:`{3,}|~{3,})[^\n]*[ \t]*\n?$/;
// 뒤쪽: 제안을 닫는 ```. 제안 바로 다음 줄에 옵니다. 언어 이름이 없는 것만 지워서, 제안 뒤에
// 진짜 코드블록이 이어지는 경우(``` 뒤에 언어 이름)를 잘못 지우지 않습니다.
const LONE_FENCE_HEAD = /^[ \t]*\r?\n?[ \t]*(?:`{3,}|~{3,})[ \t]*(?:\r?\n|$)/;

// 답변을 "보통 글"과 "수정 제안"으로 나눕니다. 제안이 하나도 없으면 글 조각 하나만 돌려줍니다.
export function splitAnswer(answer: string): AnswerPart[] {
	const parts: AnswerPart[] = [];
	let lastEnd = 0;
	let index = 0;

	PROPOSAL_PATTERN.lastIndex = 0;
	for (let match = PROPOSAL_PATTERN.exec(answer); match; match = PROPOSAL_PATTERN.exec(answer)) {
		const [whole, path, reason, before, after] = match;
		const text = answer.slice(lastEnd, match.index).replace(LONE_FENCE_TAIL, '');
		if (text.trim()) parts.push({ kind: 'text', text });
		parts.push({
			kind: 'proposal',
			proposal: {
				path: path!.trim(),
				before: before ?? '',
				after: after ?? '',
				...(reason?.trim() ? { reason: reason.trim() } : {}),
			},
			index: index++,
		});
		lastEnd = match.index + whole.length;
	}

	const tail = answer.slice(lastEnd).replace(LONE_FENCE_HEAD, '');
	if (tail.trim() || parts.length === 0) parts.push({ kind: 'text', text: tail });
	return parts;
}

// 읽어내지 못한 "수정" 마커가 글 조각에 남아 있는지. 모델이 형식을 크게 벗어나게 답해서 카드를
// 만들지 못한 경우인데, 그대로 두면 사용자는 뜻 모를 기호만 보게 되므로 화면에서 안내합니다.
export function hasUnreadableProposal(parts: readonly AnswerPart[]): boolean {
	return parts.some((part) => part.kind === 'text' && LEFTOVER_MARKER.test(part.text));
}

// ─── 노트에서 고칠 자리 찾기 ─────────────────────────────────────

export type ProposalProblem =
	| 'not-current' // 질문할 때 열려 있던 노트가 아님 — 고칠 수 있는 노트는 그 하나뿐입니다
	| 'note-missing' // 그 경로에 노트가 없음(모델이 경로를 지어냈거나 그새 옮겨짐)
	| 'not-found' // 원문을 노트에서 찾지 못함(모델이 옮겨 적은 글이 노트와 다름)
	| 'ambiguous' // 원문이 노트에 여러 번 나옴(어디를 고칠지 알 수 없음)
	| 'no-change'; // 이전과 이후가 같음(고칠 것이 없음)

export interface ProposalCheck {
	problem: ProposalProblem | null; // null이면 적용할 수 있습니다.
	// 찾은 자리(문자 위치). problem이 null일 때만 있습니다.
	range: { start: number; end: number } | null;
}

function splitKeepingOffsets(text: string): { lines: string[]; starts: number[] } {
	const lines = text.split('\n');
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1; // +1은 떼어낸 '\n'
	}
	return { lines, starts };
}

// 노트의 줄들 안에서 찾을 줄들이 연속으로 나오는 위치를 모두 찾습니다.
// loose이면 줄 끝 공백만 무시합니다(모델이 옮겨 적으면서 줄 끝 공백을 흘리는 일이 잦고, 윈도우에서
// 만든 노트는 줄 끝에 \r이 붙어 있어서 그대로는 절대 일치하지 않습니다).
// 줄 앞 들여쓰기는 무시하지 않습니다 — 목록의 깊이가 바뀌면 다른 자리이기 때문입니다.
function findLineMatches(
	haystack: readonly string[],
	needle: readonly string[],
	loose: boolean,
): number[] {
	const same = (a: string, b: string) => (loose ? a.trimEnd() === b.trimEnd() : a === b);
	const found: number[] = [];
	for (let start = 0; start + needle.length <= haystack.length; start++) {
		if (needle.every((line, offset) => same(haystack[start + offset]!, line))) found.push(start);
	}
	return found;
}

// 노트 내용에서 고칠 자리를 찾습니다. 못 찾거나 여러 곳이면 그 이유를 돌려줍니다.
export function findRange(
	body: string,
	before: string,
): { start: number; end: number } | ProposalProblem {
	// 이전이 비어 있으면 "노트 끝에 덧붙이기"입니다.
	if (before === '') return { start: body.length, end: body.length };

	const { lines, starts } = splitKeepingOffsets(body);
	const needle = before.split('\n');
	// 먼저 그대로 찾고, 없으면 줄 끝 공백을 무시하고 다시 찾습니다.
	let matches = findLineMatches(lines, needle, false);
	if (matches.length === 0) matches = findLineMatches(lines, needle, true);

	if (matches.length === 0) return 'not-found';
	if (matches.length > 1) return 'ambiguous';

	const first = matches[0]!;
	const lastLine = first + needle.length - 1;
	const start = starts[first]!;
	// 마지막 줄이면 노트 끝까지, 아니면 다음 줄이 시작하기 직전(줄바꿈 앞)까지입니다.
	let end = lastLine + 1 < lines.length ? starts[lastLine + 1]! - 1 : body.length;
	// 윈도우에서 만든 노트(\r\n)라면 줄 끝의 \r은 고칠 범위에서 뺍니다. 넣어 두면 새 글로 바꿀 때
	// 그 \r까지 함께 지워져서, 뒤따르는 줄바꿈만 \n으로 남아 한 노트 안에 줄 구분자가 섞입니다.
	if (end > start && body[end - 1] === '\r') end--;
	return { start, end };
}

// 고칠 수 있는 노트인지 봅니다. 고칠 수 있는 것은 "질문을 보낼 때 열려 있던 노트" 하나뿐입니다.
//
// 왜 질문한 시점인가: [적용]을 누른 시점을 기준으로 하면, 답변을 읽다가 다른 노트로 옮긴 순간
// 엉뚱한 파일이 고쳐집니다. 그래서 질문할 때의 노트를 메시지에 적어 두고(session-store의
// editableNote) 그것만 대상으로 삼습니다. 카드에도 그 노트 이름이 적혀 있어 헷갈릴 일이 없습니다.
export function isEditable(proposal: EditProposal, editableNote: string | null): boolean {
	return editableNote !== null && proposal.path === editableNote;
}

// 지금 노트를 읽어 제안을 적용할 수 있는지 확인합니다. 화면에 카드를 그릴 때마다 호출합니다.
// (여기서 확인한 뒤 [적용]을 누르기 전에 노트가 바뀔 수 있으므로, 저장 직전에 한 번 더 대조합니다.)
export async function checkProposal(
	app: App,
	proposal: EditProposal,
	editableNote: string | null,
): Promise<ProposalCheck> {
	if (!isEditable(proposal, editableNote)) return { problem: 'not-current', range: null };

	const file = app.vault.getFileByPath(proposal.path);
	if (!file) return { problem: 'note-missing', range: null };
	if (proposal.before === proposal.after) return { problem: 'no-change', range: null };

	const range = findRange(await app.vault.cachedRead(file), proposal.before);
	return typeof range === 'string' ? { problem: range, range: null } : { problem: null, range };
}

// ─── 실제로 고치기 ───────────────────────────────────────────────

// 노트의 [start, end)를 새 글로 바꾼 결과를 만듭니다.
// 줄 구분자는 노트의 것을 따릅니다(윈도우에서 만든 CRLF 노트에 LF 줄이 섞이지 않게).
function replaceRange(
	body: string,
	range: { start: number; end: number },
	replacement: string,
): string {
	const head = body.slice(0, range.start);
	const tail = body.slice(range.end);
	const crlf = body.includes('\r\n');
	const text = crlf ? replacement.replace(/\r?\n/g, '\r\n') : replacement.replace(/\r\n/g, '\n');

	// 노트 끝에 덧붙이는 경우에만 앞에 줄바꿈이 필요합니다(빈 노트가 아니고, 이미 줄바꿈으로 끝나지 않았다면).
	if (range.start === range.end && range.start === body.length) {
		const gap = head === '' || head.endsWith('\n') ? '' : crlf ? '\r\n' : '\n';
		return `${head}${gap}${text}`;
	}
	// 지우는 경우(새 글이 비어 있음)에는 빈 줄이 남지 않도록 뒤따르는 줄바꿈도 함께 뗍니다.
	if (text === '') return head + tail.replace(/^\r?\n/, '');
	return head + text + tail;
}

export type ApplyResult =
	| { ok: true; before: string; after: string } // 고치기 전/후의 노트 전체 내용(백업에 씁니다)
	| { ok: false; problem: ProposalProblem };

// 제안을 노트에 반영합니다. 화면에 카드를 그린 뒤 노트가 바뀌었을 수 있으므로, 저장 직전에 다시
// 대조합니다. vault.process는 "읽고 → 고치고 → 쓰기"를 한 번에 하므로, 확인과 저장 사이에 다른
// 곳에서 노트를 고쳐 그 변경이 사라지는 일이 없습니다.
export async function applyProposal(
	app: App,
	proposal: EditProposal,
	direction: 'apply' | 'revert' = 'apply',
): Promise<ApplyResult> {
	const file = app.vault.getFileByPath(proposal.path);
	if (!file) return { ok: false, problem: 'note-missing' };

	// 되돌리기는 "새 글을 찾아 원래 글로" — 방향만 뒤집습니다. 적용한 뒤 노트의 다른 곳을 더 고쳤더라도
	// 그 편집은 건드리지 않습니다(백업을 통째로 덮어쓰지 않는 이유입니다).
	const search = direction === 'apply' ? proposal.before : proposal.after;
	const replacement = direction === 'apply' ? proposal.after : proposal.before;

	let problem: ProposalProblem | null = null;
	let original = '';
	const updated = await app.vault.process(file, (current) => {
		original = current;
		const range = findRange(current, search);
		if (typeof range === 'string') {
			problem = range;
			return current; // 그대로 돌려주면 파일은 바뀌지 않습니다.
		}
		return replaceRange(current, range, replacement);
	});

	return problem ? { ok: false, problem } : { ok: true, before: original, after: updated };
}

// 되돌리기가 가능한지(적용한 새 글이 노트에 그대로 남아 있는지) 확인합니다.
export async function canRevert(app: App, proposal: EditProposal): Promise<boolean> {
	const file = app.vault.getFileByPath(proposal.path);
	if (!file) return false;
	// 되돌리기는 "이후 → 이전"이므로, 이후 글을 찾을 수 있어야 합니다.
	return typeof findRange(await app.vault.cachedRead(file), proposal.after) !== 'string';
}

// 노트 경로에서 파일 이름만(카드 제목에 씁니다).
export function noteName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}
