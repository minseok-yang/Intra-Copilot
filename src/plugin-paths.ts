import type IntraCopilotPlugin from './main';

// 플러그인 폴더의 볼트 기준 경로입니다(예: .obsidian/plugins/intra-copilot).
// 대화 기록(conversations/)과 스킬(SKILL/)이 이 폴더 안에 저장됩니다. 노트가 아니라서
// 일반 파일 탐색기/검색에는 나타나지 않습니다.
// 주의: 플러그인 폴더를 통째로 지우고 다시 넣으면 그 안의 대화 기록·스킬도 함께 사라집니다.
export function pluginDir(plugin: IntraCopilotPlugin): string {
	return plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}
