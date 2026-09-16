import { normalizePath, Notice, TFile } from 'obsidian';
import type IntraCopilotPlugin from '../main';

// 양식(템플릿): 새 노트를 어떤 모양으로 쓸지 정해 둔 평범한 .md 노트입니다.
//
// 왜 볼트 안의 노트인가: 사내에서는 코드를 고칠 수 없지만 노트는 Obsidian으로 바로 고칠 수 있습니다.
// 그래서 양식은 플러그인 폴더가 아니라 볼트 안 폴더(설정의 "양식 폴더")에 둡니다. 새 문법은 없습니다 —
// 괄호 ( ) 안에 무엇을 채울지 적어 두면 모델이 그 설명을 읽고 채웁니다.
//
// 양식 이름 = 파일 이름입니다. 양식 노트의 속성(맨 위 --- 사이)은 "만든 노트에 남길 속성 키" 목록으로도
// 쓰입니다(generator/note-build.ts의 filterFrontmatter).

export interface GeneratorTemplate {
	file: TFile;
	name: string; // 파일 이름(확장자 제외)
}

// 설정값을 볼트 기준 경로로 맞춥니다. 비었거나 '/'면 ''(볼트 맨 위)입니다.
export function cleanVaultFolder(value: string): string {
	const path = value.trim() ? normalizePath(value.trim()) : '';
	return path === '/' ? '' : path;
}

export function templateFolder(plugin: IntraCopilotPlugin): string {
	return cleanVaultFolder(plugin.settings.generator.templateFolder);
}

// 양식 폴더 안의 .md 노트를 이름 순으로 돌려줍니다(하위 폴더도 포함). 폴더가 없으면 빈 목록입니다.
export function listTemplates(plugin: IntraCopilotPlugin): GeneratorTemplate[] {
	const folder = templateFolder(plugin);
	const prefix = folder ? `${folder}/` : '';
	return plugin.app.vault
		.getMarkdownFiles()
		.filter((file) => (prefix ? file.path.startsWith(prefix) : true))
		.map((file) => ({ file, name: file.basename }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

// 폴더가 없으면 만들고 알립니다(만들었으면 true). 양식 폴더·저장 폴더를 지정하지 않았을 때
// 기본 폴더(Generator·Generator-inbox)가 조용히 생기지 않게, 볼트에 폴더를 만드는 일은 늘 알립니다.
export async function ensureFolder(plugin: IntraCopilotPlugin, path: string): Promise<boolean> {
	const { vault } = plugin.app;
	if (!path || vault.getAbstractFileByPath(path)) return false;
	try {
		await vault.createFolder(path);
		new Notice(plugin.strings().folders.created.replace('{path}', path));
		return true;
	} catch {
		return false; // 같은 이름의 파일이 있는 드문 경우. 부르는 쪽이 이어서 실패를 알립니다.
	}
}

// 폴더를 처음 만들 때 한 번만 넣어 두는 예시입니다(지우면 다시 생기지 않습니다 — 폴더에 .md가 하나도
// 없을 때만 만듭니다). 괄호 설명이 그대로 "무엇을 채울지"를 모델에게 알려 줍니다.
const EXAMPLE_NAME = '회의록';
const EXAMPLE_TEMPLATE = `---
created:
tags: [회의]
---

# (회의 제목)

## 개요
(무엇에 대한 회의였는지 한두 줄)

## 참석자
- (이름 / 소속·역할)

## 논의 내용
- (주제별로 요점만)

## 결정 사항
- (정해진 것. 없으면 "없음")

## 할 일
- [ ] (누가 / 무엇을 / 언제까지)
`;

// 양식 폴더에 .md가 하나도 없으면 예시 양식 하나를 만듭니다(제너레이터 창을 열 때 한 번 확인).
// 볼트에 파일을 만드는 일이라 조용히 하지 않고 알림으로 알립니다.
export async function ensureExampleTemplate(plugin: IntraCopilotPlugin): Promise<void> {
	if (listTemplates(plugin).length > 0) return;
	const folder = templateFolder(plugin);
	const path = normalizePath(folder ? `${folder}/${EXAMPLE_NAME}.md` : `${EXAMPLE_NAME}.md`);
	const { vault } = plugin.app;
	if (vault.getAbstractFileByPath(path)) return; // .md가 아닌 것과 이름이 겹치는 드문 경우
	try {
		await ensureFolder(plugin, folder);
		await vault.create(path, EXAMPLE_TEMPLATE);
		new Notice(plugin.strings().generator.exampleCreated.replace('{path}', path));
	} catch {
		// 만들지 못해도 기능 자체는 쓸 수 있습니다(사용자가 양식을 직접 만들면 됩니다).
	}
}
