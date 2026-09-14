import type { ChatMessage } from '../llm/client';
import { INPUT_PLACEHOLDER, type Skill } from '../skills/skill-store';
import type { StoredMessage } from './session-store';
import { describeTargetForModel } from './vault-context';

// 저장된 대화를 서버로 보낼 모양으로 바꿉니다.
//
// 마지막 사용자 질문(= 지금 보내는 질문)에만 이번에 붙일 것들을 넣습니다.
//   [작업 지시 — 스킬 "이름"]  ← /로 고른 스킬의 지시문
//   [볼트 자료]                 ← @로 지정한 폴더·노트 내용(vault-context.ts)
//   [사용자 요청]               ← 입력칸에 쓴 글
// 이전 질문에는 "(당시 지정한 자료: … · 당시 사용한 스킬: …)" 한 줄만 남기고 내용은 다시 보내지 않습니다.
// 그래서 대화가 길어져도 요청 크기는 "이번 자료·지시문 1회분 + 대화"로 일정합니다.
// (이 안내 글들은 모델에게 보내는 것이라 화면 언어와 상관없이 한국어입니다.)

export interface LatestAttachments {
	context: string | null; // buildVaultContext()가 만든 [볼트 자료]
	skill: Pick<Skill, 'name' | 'instructions'> | null;
}

function composeLatest(content: string, { context, skill }: LatestAttachments): string {
	const parts: string[] = [];
	let request = content;
	if (skill) {
		// 지시문에 {{input}}이 있으면 그 자리에 입력한 글을 넣고, 따로 덧붙이지 않습니다.
		const usesInput = skill.instructions.includes(INPUT_PLACEHOLDER);
		const instructions = usesInput
			? skill.instructions.split(INPUT_PLACEHOLDER).join(content || '(없음)')
			: skill.instructions;
		parts.push(`[작업 지시 — 스킬 "${skill.name}"]\n${instructions}`);
		if (usesInput) request = '';
	}
	if (context) parts.push(context);
	if (request) parts.push(parts.length > 0 ? `[사용자 요청]\n${request}` : request);
	return parts.join('\n\n');
}

export function composeRequestConversation(
	conversation: readonly StoredMessage[],
	latest: LatestAttachments,
): ChatMessage[] {
	const lastIndex = conversation.length - 1;
	return conversation.map((message, index): ChatMessage => {
		const { role, content } = message;
		if (role !== 'user') return { role, content };
		if (index === lastIndex) return { role, content: composeLatest(content, latest) };

		const notes: string[] = [];
		if (message.targets?.length) {
			notes.push(`당시 지정한 자료: ${message.targets.map(describeTargetForModel).join(', ')}`);
		}
		if (message.skill) notes.push(`당시 사용한 스킬: ${message.skill.name}`);
		return { role, content: notes.length > 0 ? `(${notes.join(' · ')})\n${content}` : content };
	});
}
