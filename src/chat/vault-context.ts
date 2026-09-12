import { App, TFile, TFolder } from 'obsidian';

// 챗봇 입력칸 위에 칩으로 올라온 "대화 대상"(폴더·노트)과, 그 내용을 질문에 붙이는 방법입니다.
// 칩에는 사용자가 @로 직접 고른 것과, 지금 열려 있는 노트(자동, composer.syncCurrentNote)가 있습니다.
//
// 원칙
// - 노트 내용은 대화 파일에 저장하지 않습니다. 보낼 때마다 그 순간의 노트를 새로 읽어서, 이번
//   질문에만 붙입니다. 저장되는 것은 "어떤 대상을 지정했는지(경로)"와 "몇 개·몇 자를 보냈는지"뿐입니다.
// - 이전 질문에는 "당시 지정한 자료: 경로" 한 줄만 남깁니다. 그래서 대화가 길어져도 서버로 가는
//   노트 분량은 항상 자료 1회분입니다(설정의 "노트 자료 최대 글자 수" 이내).
// - 아래 [볼트 자료] 안내문은 모델에게 보내는 글이라 화면 언어와 상관없이 한국어입니다.
//   (문구를 바꾸려면 이 파일을 고쳐서 다시 빌드해야 합니다.)

// 볼트 전체(맨 위 폴더)의 경로. Obsidian은 볼트 맨 위 폴더를 '/'로 부릅니다.
export const VAULT_ROOT_PATH = '/';

export interface ChatTarget {
	kind: 'folder' | 'note';
	path: string; // 볼트 기준 경로(예: 프로젝트/회의록.md). 볼트 전체는 '/'
}

// 질문에 실제로 붙여 보낸 분량. 사용자 말풍선에 "노트 3개 · 5,200자 첨부"처럼 보여줍니다.
export interface AttachedInfo {
	notes: number;
	chars: number;
	truncated: boolean; // 글자 수 제한으로 일부를 빼고 보냈는지
	paths?: string[]; // 내용이 실제로 들어간 노트 경로(말풍선에서 펼쳐 볼 수 있게)
}

export interface VaultContext {
	text: string;
	info: AttachedInfo;
}

export function isChatTarget(value: unknown): value is ChatTarget {
	if (!value || typeof value !== 'object') return false;
	const { kind, path } = value as Record<string, unknown>;
	return (kind === 'folder' || kind === 'note') && typeof path === 'string' && path !== '';
}

export function isAttachedInfo(value: unknown): value is AttachedInfo {
	if (!value || typeof value !== 'object') return false;
	const { notes, chars, truncated, paths } = value as Record<string, unknown>;
	if (typeof notes !== 'number' || typeof chars !== 'number' || typeof truncated !== 'boolean') {
		return false;
	}
	return paths === undefined || (Array.isArray(paths) && paths.every((p) => typeof p === 'string'));
}

export function sameTarget(a: ChatTarget, b: ChatTarget): boolean {
	return a.kind === b.kind && a.path === b.path;
}

// 지정한 대상이 지금 볼트에 실제로 있는지 확인하고, 있으면 그 폴더/노트를 돌려줍니다.
export function resolveTarget(app: App, target: ChatTarget): TFile | TFolder | null {
	if (target.kind === 'folder') {
		const folder =
			target.path === VAULT_ROOT_PATH
				? app.vault.getRoot()
				: app.vault.getAbstractFileByPath(target.path);
		return folder instanceof TFolder ? folder : null;
	}
	const file = app.vault.getAbstractFileByPath(target.path);
	return file instanceof TFile && file.extension === 'md' ? file : null;
}

// 폴더·노트 이름이 바뀌거나 옮겨졌을 때 지정한 경로도 따라가게 합니다.
// 바뀐 것과 상관없는 대상이면 null을 돌려줍니다.
export function renamedTarget(target: ChatTarget, oldPath: string, newPath: string): ChatTarget | null {
	if (target.path === oldPath) return { ...target, path: newPath };
	if (target.path.startsWith(`${oldPath}/`)) {
		return { ...target, path: `${newPath}${target.path.slice(oldPath.length)}` };
	}
	return null;
}

// 지운 폴더·노트(또는 지운 폴더 안의 대상)인지
export function isRemovedBy(target: ChatTarget, removedPath: string): boolean {
	return target.path === removedPath || target.path.startsWith(`${removedPath}/`);
}

// 모델에게 대상을 가리킬 때 쓰는 이름
export function describeTargetForModel(target: ChatTarget): string {
	if (target.kind === 'note') return target.path;
	return target.path === VAULT_ROOT_PATH ? '볼트 전체' : `${target.path}/`;
}

function notesInFolder(app: App, folder: TFolder): TFile[] {
	const prefix = `${folder.path}/`;
	return app.vault
		.getMarkdownFiles()
		.filter((file) => folder.isRoot() || file.path.startsWith(prefix))
		.sort((a, b) => a.path.localeCompare(b.path));
}

// 노트를 고쳐 달라는 요청일 때 모델이 지켜야 하는 답변 형식입니다(승인형 Diff).
//
// 이 형식으로 답해야 챗봇 화면에 변경 전/후를 보여주는 카드와 [적용] 버튼이 생깁니다
// (답변을 나누는 곳은 chat/edit-proposal.ts, 화면에 그리는 곳은 ui/chat/edit-card.ts).
// "이전"은 노트에서 고칠 자리를 찾는 열쇠라서, 자료에 있는 글자와 정확히 같아야 합니다.
// 다르면 적용 버튼이 잠기고 사용자에게 이유가 표시됩니다 — 모델이 착각해서 엉뚱한 곳을 고치는 것보다
// 아무것도 고치지 않는 편이 안전하기 때문입니다.
//
// 화면 언어와 상관없이 한국어입니다(모델에게 보내는 글). 바꾸려면 이 파일을 고쳐 다시 빌드해야 합니다.
function editFormat(editableNote: string | null): string {
	return [
		'[노트 수정 요청에 답하는 방법]',
		'사용자가 노트를 고쳐 달라고 했을 때만 아래 형식을 쓰세요. 그냥 묻는 질문에는 평소대로 답하면 됩니다.',
		'고칠 곳마다 이 덩어리를 하나씩, 아래 모양 그대로 적으세요.',
		'',
		`<<<수정: ${editableNote ?? '노트/경로.md'}>>>`,
		'<<<이유>>>',
		'(왜 이렇게 고치는지 한두 문장)',
		'<<<이전>>>',
		'(고칠 부분이 지금 노트에 적혀 있는 그대로)',
		'<<<이후>>>',
		'(그 자리에 들어갈 새 내용)',
		'<<<수정 끝>>>',
		'',
		// 고칠 수 있는 노트를 하나로 못 박습니다. 여러 노트를 자료로 받아도 바뀔 수 있는 파일은 항상
		// 하나뿐이라, 사용자가 "어느 노트가 고쳐지는지" 헷갈릴 일이 없습니다(읽기는 넓게, 쓰기는 좁게).
		...(editableNote
			? [
					`- **고칠 수 있는 노트는 "${editableNote}" 하나뿐입니다.** 사용자가 지금 화면에 열어 둔 노트입니다.`,
					'- 다른 노트를 고치자고 제안하면 사용자 화면에서 적용 버튼이 잠깁니다. 다른 노트의 수정이 필요하면, 수정 덩어리 대신 "그 노트를 열고 다시 요청하세요"라고 말로 알려 주세요.',
				]
			: [
					'- 지금은 열려 있는 노트가 없어서 어떤 노트도 고칠 수 없습니다. 수정 덩어리를 쓰지 말고, 고칠 노트를 열고 다시 요청하라고 알려 주세요.',
				]),
		'- 노트 전체를 다시 쓰지 말고, 고칠 부분만 넣으세요.',
		'- "이전"은 위 자료에 있는 글자·띄어쓰기·기호와 정확히 같아야 합니다. 한 글자라도 다르면 적용할 수 없습니다.',
		'- "이전"과 똑같은 대목이 노트에 여러 번 나온다면, 앞뒤 줄을 더 넣어서 한 곳만 가리키게 하세요.',
		'- 노트 끝에 내용을 덧붙이기만 할 때는 "이전"을 비워 두세요.',
		'- 고칠 곳이 여러 군데면 이 덩어리를 여러 개 쓰세요.',
		'- "이유"에는 무엇을 왜 고치는지 적으세요. 사용자는 이 이유를 읽고 적용할지 정합니다.',
		'- 요청받지 않은 부분은 고치지 마세요. 표현을 다듬고 싶더라도 요청한 것만 바꾸세요.',
		'- 파일에 반영할지는 사용자가 [적용] 버튼으로 직접 정합니다. 당신이 고치는 것이 아닙니다.',
	].join('\n');
}

// 남은 글자 수가 이보다 적으면 노트 내용을 더 넣지 않습니다(의미 없는 짧은 조각 방지).
const MIN_USEFUL_CHARS = 200;
// 폴더의 노트 목록이 차지할 수 있는 최대 비율. 나머지는 노트 내용에 씁니다.
const LIST_SHARE = 0.3;
const CUT_MARK = '(… 글자 수 제한으로 이 노트는 여기까지만 넣었습니다)';

// 지정한 대상들의 내용을 읽어서 모델에게 보낼 [볼트 자료] 글을 만듭니다.
// maxChars는 노트 내용과 노트 목록에 쓸 수 있는 글자 수의 합계입니다(0이면 제한 없음).
// 호출하기 전에 resolveTarget으로 대상이 있는지 확인해 두세요 — 없는 대상은 건너뜁니다.
export async function buildVaultContext(
	app: App,
	targets: readonly ChatTarget[],
	maxChars: number,
	editableNote: string | null,
): Promise<VaultContext> {
	let remaining = maxChars > 0 ? maxChars : Number.POSITIVE_INFINITY;
	let truncated = false;
	const included = new Set<string>();
	const parts: string[] = [];

	// 노트 하나의 내용을 넣습니다. 이미 넣은 노트면 'duplicate', 글자 수가 모자라면 'skipped'.
	const addNote = async (file: TFile): Promise<'added' | 'duplicate' | 'skipped'> => {
		if (included.has(file.path)) return 'duplicate';
		if (remaining < MIN_USEFUL_CHARS) {
			truncated = true;
			return 'skipped';
		}
		const body = await app.vault.cachedRead(file);
		const cut = body.length > remaining;
		const shown = cut ? body.slice(0, remaining) : body;
		if (cut) truncated = true;
		remaining -= shown.length;
		included.add(file.path);
		parts.push(
			`<<<노트 시작: ${file.path}>>>\n${shown}${cut ? `\n${CUT_MARK}` : ''}\n<<<노트 끝: ${file.path}>>>`,
		);
		return 'added';
	};

	for (const target of targets) {
		const resolved = resolveTarget(app, target);
		if (resolved instanceof TFile) {
			const result = await addNote(resolved);
			if (result === 'skipped') {
				parts.push(`(글자 수 제한으로 노트 ${resolved.path}의 내용은 넣지 못했습니다.)`);
			}
			continue;
		}
		if (!(resolved instanceof TFolder)) continue;

		const notes = notesInFolder(app, resolved);
		const title = resolved.isRoot() ? `볼트 전체 (${app.vault.getName()})` : `${resolved.path}/`;
		parts.push(`## 폴더: ${title} — 노트 ${notes.length}개`);
		if (notes.length === 0) continue;

		// 노트 목록: 모델이 "이 폴더에 무엇이 있는지"는 알 수 있도록 내용보다 먼저 넣습니다.
		const listLimit = Number.isFinite(remaining)
			? Math.max(MIN_USEFUL_CHARS, Math.floor(remaining * LIST_SHARE))
			: Number.POSITIVE_INFINITY;
		const lines: string[] = [];
		let listUsed = 0;
		for (const note of notes) {
			const line = `- ${note.path}`;
			if (listUsed + line.length + 1 > listLimit) break;
			lines.push(line);
			listUsed += line.length + 1;
		}
		if (lines.length < notes.length) {
			lines.push(`- … 외 ${notes.length - lines.length}개 (글자 수 제한으로 목록 생략)`);
			truncated = true;
		}
		parts.push(`노트 목록:\n${lines.join('\n')}`);
		remaining -= listUsed;

		let skipped = 0;
		for (const note of notes) {
			if ((await addNote(note)) === 'skipped') skipped++;
		}
		if (skipped > 0) {
			parts.push(`(글자 수 제한으로 노트 ${skipped}개는 내용을 넣지 못했습니다 — 목록에만 있습니다.)`);
		}
	}

	const header = [
		'[볼트 자료]',
		'사용자가 대화 대상으로 올려 둔 Obsidian 볼트의 폴더·노트입니다. 아래 자료를 근거로 답하세요.',
		'- 자료에 없는 내용은 추측하지 말고, 자료에 없다고 말하세요.',
		'- 특정 노트를 가리킬 때는 노트 경로를 함께 적으세요.',
		...(truncated
			? ['- 글자 수 제한으로 일부 자료가 빠졌습니다. 빠진 노트는 목록에 이름만 있습니다.']
			: []),
	];
	const text = [header.join('\n'), editFormat(editableNote), ...parts].join('\n\n');
	return {
		text,
		info: { notes: included.size, chars: text.length, truncated, paths: [...included] },
	};
}
