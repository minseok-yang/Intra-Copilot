import { App, normalizePath } from 'obsidian';

// 켜 둔 코어 "템플릿" 플러그인·Templater에 지정한 템플릿 폴더입니다. 템플릿은 지식 노트가 아니라서 리마인더(다시 볼 노트)와
// 링크(색인·추천)가 자동으로 뺍니다. 두 플러그인 모두 설정을 읽는 공개 API가 없어 내부 값을 읽으며, 구조가 바뀌어
// 못 읽으면 조용히 건너뜁니다.

// 폴더 설정값을 볼트 기준 경로로 맞춥니다. 비었거나 볼트 맨 위('/')면 ''(뺄 폴더 없음)입니다.
function folderPath(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) return '';
	const path = normalizePath(value);
	return path === '/' ? '' : path;
}

export function templateFolders(app: App): string[] {
	const internal = app as unknown as {
		internalPlugins?: {
			getPluginById?: (id: string) => { enabled?: boolean; instance?: { options?: { folder?: unknown } } } | null;
		};
		plugins?: { getPlugin?: (id: string) => { settings?: { templates_folder?: unknown } } | null };
	};
	const core = internal.internalPlugins?.getPluginById?.('templates');
	const templater = internal.plugins?.getPlugin?.('templater-obsidian');
	return [core?.enabled ? core.instance?.options?.folder : undefined, templater?.settings?.templates_folder]
		.map(folderPath)
		.filter((folder) => folder !== '');
}
