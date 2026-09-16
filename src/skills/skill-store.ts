import { parseYaml, stringifyYaml } from 'obsidian';
import type IntraCopilotPlugin from '../main';

// 스킬: 자주 쓰는 작업 지시를 이름을 붙여 저장해 둔 것입니다. 챗봇 입력칸에서 /로 불러 씁니다.
//
// ─── 저장 구조 ─────────────────────────────────────────────────────
// SKILL/
//   note-links.md   ← 스킬 하나당 파일 하나. 파일 이름(확장자 제외)이 스킬의 id입니다.
//
// 파일 모양:
//   ---
//   name: 노트 링크 정리
//   description: 지정한 노트의 링크를 점검하고 링크를 제안합니다
//   ---
//
//   (여기부터 끝까지가 지시문. {{input}}을 쓰면 그 자리에 입력칸의 글이 들어갑니다.)
//
// 코드가 아니라 텍스트 파일이므로, 사내에서도 메모장 같은 편집기로 직접 고치거나 파일을 복사해
// 동료와 나눌 수 있습니다(다시 빌드할 필요 없음).

export interface Skill {
	id: string; // 파일 이름(확장자 제외)
	name: string; // 챗봇에서 / 뒤에 입력해 찾는 이름
	description: string;
	instructions: string; // 지시문(본문)
}

const SKILL_DIR_NAME = 'SKILL';
// 지시문 안에서 입력칸의 글로 바뀌는 자리
export const INPUT_PLACEHOLDER = '{{input}}';

// 스킬 폴더를 처음 만들 때 한 번만 넣어 두는 예시입니다(지워도 다시 생기지 않습니다).
const EXAMPLE_SKILL: Skill = {
	id: 'note-links',
	name: '노트 링크 정리',
	description: '@로 지정한 노트의 링크를 점검하고, 링크로 걸면 좋을 용어를 제안합니다',
	instructions: [
		'@로 지정한 노트를 읽고 다음을 해 주세요.',
		'1. 노트 안의 [[링크]]를 모두 나열하고, 볼트 자료에서 찾을 수 없는(깨졌을 수 있는) 링크를 알려 주세요.',
		'2. 본문에서 다른 노트로 링크를 걸면 좋을 핵심 용어를 찾아 [[용어]] 형태로 제안해 주세요.',
		'3. 제안을 반영한 노트 전체를 보여 주세요.',
		'',
		`추가 요청: ${INPUT_PLACEHOLDER}`,
	].join('\n'),
};

export function skillsDir(plugin: IntraCopilotPlugin): string {
	return `${plugin.pluginDir()}/${SKILL_DIR_NAME}`;
}

function skillPath(plugin: IntraCopilotPlugin, id: string): string {
	return `${skillsDir(plugin)}/${id}.md`;
}

// 파일 맨 앞의 --- 로 둘러싼 머리말(이름·설명)
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function textField(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number') return String(value);
	return '';
}

// 파일 내용을 스킬로 읽습니다. 머리말이 없거나 깨졌으면 파일 이름을 스킬 이름으로 쓰고,
// 파일 전체(또는 머리말 뒤)를 지시문으로 봅니다.
function parseSkill(raw: string, id: string): Skill {
	let name = '';
	let description = '';
	let body = raw;
	const match = FRONTMATTER.exec(raw);
	if (match) {
		body = raw.slice(match[0].length);
		try {
			const data: unknown = parseYaml(match[1] ?? '');
			if (data && typeof data === 'object') {
				const fields = data as Record<string, unknown>;
				name = textField(fields.name);
				description = textField(fields.description);
			}
		} catch {
			// 머리말 문법이 틀렸으면 이름·설명 없이 본문만 씁니다.
		}
	}
	return { id, name: name || id, description, instructions: body.trim() };
}

function serializeSkill(skill: Skill): string {
	const header = stringifyYaml({ name: skill.name, description: skill.description }).trimEnd();
	return `---\n${header}\n---\n\n${skill.instructions.trim()}\n`;
}

async function ensureSkillsDir(plugin: IntraCopilotPlugin): Promise<void> {
	const { adapter } = plugin.app.vault;
	const dir = skillsDir(plugin);
	if (await adapter.exists(dir)) return;
	await adapter.mkdir(dir);
	await adapter.write(skillPath(plugin, EXAMPLE_SKILL.id), serializeSkill(EXAMPLE_SKILL));
}

// 스킬 폴더의 .md 파일을 전부 읽어 이름 순으로 돌려줍니다(폴더가 없으면 예시와 함께 만듭니다).
// 읽을 수 없는 파일은 조용히 건너뜁니다. 지시문이 빈 스킬도 포함합니다(설정 화면에서 고칠 수 있도록).
export async function listSkills(plugin: IntraCopilotPlugin): Promise<Skill[]> {
	const { adapter } = plugin.app.vault;
	await ensureSkillsDir(plugin);
	const { files } = await adapter.list(skillsDir(plugin));
	const skills = await Promise.all(
		files
			.filter((file) => file.toLowerCase().endsWith('.md'))
			.map(async (file): Promise<Skill | null> => {
				const id = file.slice(file.lastIndexOf('/') + 1, -'.md'.length);
				try {
					return parseSkill(await adapter.read(file), id);
				} catch {
					return null;
				}
			}),
	);
	return skills
		.filter((skill): skill is Skill => skill !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveSkill(plugin: IntraCopilotPlugin, skill: Skill): Promise<void> {
	await ensureSkillsDir(plugin);
	await plugin.app.vault.adapter.write(skillPath(plugin, skill.id), serializeSkill(skill));
}

export async function deleteSkill(plugin: IntraCopilotPlugin, id: string): Promise<void> {
	const path = skillPath(plugin, id);
	if (await plugin.app.vault.adapter.exists(path)) {
		await plugin.app.vault.adapter.remove(path);
	}
}

// 새 스킬의 파일 이름을 이름에서 만듭니다. 파일 이름에 쓸 수 없는 글자는 빼고, 공백은 -로 바꾸고,
// 이미 같은 이름의 파일이 있으면 뒤에 -2, -3…을 붙입니다. (나중에 이름을 바꿔도 파일 이름은 그대로입니다.)
export async function newSkillId(plugin: IntraCopilotPlugin, name: string): Promise<string> {
	const base =
		name
			.trim()
			.replace(/[\\/:*?"<>|#^[\]{}]/g, '')
			.replace(/\s+/g, '-')
			.replace(/^\.+/, '')
			.slice(0, 60) || 'skill';
	let id = base;
	for (let n = 2; await plugin.app.vault.adapter.exists(skillPath(plugin, id)); n++) {
		id = `${base}-${n}`;
	}
	return id;
}
