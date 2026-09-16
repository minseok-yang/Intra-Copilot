import { normalizePath, TFile } from 'obsidian';
import type IntraCopilotPlugin from '../main';
import { type LlmErrorKind, sendChatMessage } from '../llm/client';
import { describeGeneratorError } from '../i18n';
import { buildNote } from './note-build';
import { cleanVaultFolder, ensureFolder, type GeneratorTemplate } from './templates';
import { formatDate, propertyNames } from '../reminder/note-properties';

// 자료 + 양식을 LLM 서버로 보내 새 노트를 만드는 곳입니다.
//
// - 통신은 챗봇과 같은 LLM 서버 하나뿐입니다(settings.llm). 임베딩 서버·MCP를 쓰지 않습니다.
// - 스트리밍을 쓰지 않습니다(결정 14). 노트는 다 받은 뒤 한 번에 만들기 때문에 글자가 차례로 나타날 자리가 없습니다.
// - 미리보기 없이 바로 만들고 엽니다. 되돌리기는 "만든 노트를 지우기"입니다(챗봇의 승인형 Diff는
//   기존 노트를 고칠 때 쓰는 장치라 여기에는 쓰지 않습니다).
// - 자료 원문은 저장하지 않습니다. 이 함수가 받은 글은 요청에만 쓰이고 어디에도 쓰지 않습니다.

// 모델에게 주는 고정 안내입니다. 화면 언어와 상관없이 한국어입니다(모델에게 보내는 글).
// 사용자가 고칠 수 있는 부분은 설정의 공통 지시문(settings.generator.instructions)입니다.
const FRAME = [
	'[제너레이터]',
	'사용자가 받은 자료를 Obsidian 노트 하나로 정리하는 일입니다.',
	'',
	'답하는 방법',
	'- 첫 줄에 "제목: (노트 제목)"을 쓰세요. 이 제목이 노트 파일 이름이 됩니다. 자료 내용을 나타내는 짧은 한 줄로 쓰고, 날짜나 번호를 억지로 붙이지 마세요.',
	'- 그다음 줄부터 노트 내용만 쓰세요. 인사말이나 설명을 앞뒤에 붙이지 마세요.',
	'- 노트 전체를 코드블록(```)으로 감싸지 마세요.',
].join('\n');

export type GenerateOutcome =
	| { ok: true; file: TFile; droppedKeys: string[]; titleFromModel: boolean; renamed: boolean }
	// kind는 서버 요청이 실패한 원인입니다. 화면에서 [중지](cancelled)를 오류와 다르게 보여 주려고
	// 그대로 넘깁니다. 노트를 만드는 도중(파일 쓰기)에 실패하면 원인이 없어 kind가 없습니다.
	| { ok: false; kind?: LlmErrorKind; message: string; detail?: string };

// 노트 이름은 모델이 지은 제목이라, 이미 있는 노트와 겹칠 수 있습니다(같은 메일을 두 번 정리하는 등).
// 그때 덮어쓰는 일은 절대 없고, 이름을 다르게 지어 새 노트를 만듭니다.
//   "제목" → "제목 (2026-09-16)" → "제목 (2026-09-16) 2" → …
// 번호만 붙이면 "제목 2"가 무엇인지 나중에 알 수 없지만, 날짜가 있으면 언제 만든 것인지 보입니다.
// 이름이 바뀌었으면 renamed로 알려 화면에서 사용자에게 알립니다(다른 이름으로 조용히 저장되지 않게).
function uniquePath(
	plugin: IntraCopilotPlugin,
	folder: string,
	title: string,
): { path: string; renamed: boolean } {
	const dir = folder ? `${folder}/` : '';
	const pathFor = (name: string) => normalizePath(`${dir}${name}.md`);
	const taken = (name: string) => plugin.app.vault.getAbstractFileByPath(pathFor(name)) !== null;

	if (!taken(title)) return { path: pathFor(title), renamed: false };
	const dated = `${title} (${formatDate(Date.now())})`;
	if (!taken(dated)) return { path: pathFor(dated), renamed: true };
	for (let n = 2; n < 1000; n++) {
		if (!taken(`${dated} ${n}`)) return { path: pathFor(`${dated} ${n}`), renamed: true };
	}
	// 같은 날 1000개까지 겹치는 일은 없겠지만, 그래도 겹치면 시각을 붙여 반드시 다른 이름을 만듭니다.
	return { path: pathFor(`${dated} ${Date.now()}`), renamed: true };
}

export async function generateNote(
	plugin: IntraCopilotPlugin,
	options: { source: string; template: GeneratorTemplate; cancelSignal?: AbortSignal },
): Promise<GenerateOutcome> {
	const strings = plugin.strings().generator;
	const { generator, llm } = plugin.settings;
	const templateText = await plugin.app.vault.cachedRead(options.template.file);

	const prompt = [
		FRAME,
		generator.instructions.trim(),
		`[양식: ${options.template.name}]`,
		templateText,
		'[원본 자료]',
		options.source.trim(),
	].join('\n\n');

	const result = await sendChatMessage(llm, [{ role: 'user', content: prompt }], options.cancelSignal);
	if (!result.ok) {
		const described = describeGeneratorError(plugin.settings.general.language, result);
		return { ok: false, kind: result.kind, message: described.summary, detail: described.detail };
	}
	if (!result.reply.trim()) return { ok: false, message: strings.emptyReply };

	// 양식에 작성일 속성이 있는데 모델이 비워 두었으면 오늘 날짜를 채웁니다(리마인더가 이 날짜로
	// "새 노트 유예 기간"을 봅니다 — 같은 속성 이름을 쓰도록 리마인더 설정에서 가져옵니다).
	const built = buildNote(result.reply, {
		templateText,
		fills: { [propertyNames(plugin.settings.reminder).created]: formatDate(Date.now()) },
		fallbackTitle: strings.titleFallback,
	});

	const folder = cleanVaultFolder(generator.outputFolder);
	try {
		// 저장 폴더가 아직 없으면 만들고 알립니다(설정에서 [찾기]로 고르지 않고 기본 폴더를 쓰는 경우).
		await ensureFolder(plugin, folder);
		const { path, renamed } = uniquePath(plugin, folder, built.title);
		const file = await plugin.app.vault.create(path, built.content);
		return {
			ok: true,
			file,
			droppedKeys: built.droppedKeys,
			titleFromModel: built.titleFromModel,
			renamed,
		};
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}
