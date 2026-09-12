import IntraCopilotPlugin from '../main';
import { pluginDir } from '../plugin-paths';

// [적용]을 누르기 직전의 노트 원본을 보관합니다.
//
// 되돌리기는 보통 이 백업을 쓰지 않습니다 — 적용한 부분만 원래 글로 되돌리는 편이(edit-proposal.ts의
// applyProposal(…, 'revert')) 그 뒤에 사용자가 노트의 다른 곳을 고친 것까지 지우지 않기 때문입니다.
// 이 백업은 그 되돌리기마저 실패했을 때(적용한 부분을 또 고쳐서 찾을 수 없을 때) 손으로 복구할 수 있게
// 남겨 두는 안전망입니다.
//
// 저장 위치: <플러그인폴더>/backups/2026-09-12T04-33-12-회의록.md
// 노트가 아니라 플러그인 폴더 안이라서 볼트 검색·그래프에는 나타나지 않고, 그냥 마크다운 파일이라
// 메모장으로 열어 내용을 확인하거나 복사할 수 있습니다.
// 주의: 플러그인 폴더를 통째로 지우고 다시 넣으면 이 백업도 함께 사라집니다.

// 보관할 최대 개수. 넘으면 오래된 것부터 지웁니다. 노트 원본을 통째로 담으므로 무한정 쌓이면
// 플러그인 폴더가 계속 커집니다.
const MAX_BACKUPS = 200;

function backupsDir(plugin: IntraCopilotPlugin): string {
	return `${pluginDir(plugin)}/backups`;
}

export function backupPath(plugin: IntraCopilotPlugin, name: string): string {
	return `${backupsDir(plugin)}/${name}`;
}

// 노트 경로를 파일 이름으로 씁니다. 폴더 구분선(/)까지 남겨서(-로 바꿔서) 같은 이름의 노트가 여러
// 폴더에 있어도 어느 것의 백업인지 알 수 있습니다. 파일 이름에 쓸 수 없는 글자와 앞뒤 공백·점은
// 지우고, 너무 길면 뒤쪽(파일 이름에 가까운 쪽)을 남깁니다 — 윈도우의 경로 길이 제한 때문입니다.
const MAX_NAME_CHARS = 80;

function safeName(notePath: string): string {
	const cleaned = notePath.replace(/[\\/:*?"<>|]/g, '-').replace(/^[\s.]+|[\s.]+$/g, '');
	if (!cleaned) return 'note';
	return cleaned.length > MAX_NAME_CHARS ? cleaned.slice(-MAX_NAME_CHARS) : cleaned;
}

// 2026-09-12T04-33-12-345 (파일 이름에 쓸 수 있게 : . 을 -로)
// 밀리초까지 넣습니다 — 초까지만 쓰면 같은 노트를 1초 안에 두 번 고쳤을 때 첫 백업이 덮어써집니다.
function timestamp(): string {
	return new Date().toISOString().slice(0, 23).replace(/[:.]/g, '-');
}

// 오래된 백업부터 지워서 MAX_BACKUPS개 이하로 유지합니다. 파일 이름이 시각으로 시작하므로
// 이름 순서가 곧 오래된 순서입니다.
async function pruneBackups(plugin: IntraCopilotPlugin): Promise<void> {
	const dir = backupsDir(plugin);
	const { files } = await plugin.app.vault.adapter.list(dir);
	const sorted = files.filter((file) => file.endsWith('.md')).sort();
	for (const file of sorted.slice(0, Math.max(0, sorted.length - MAX_BACKUPS))) {
		await plugin.app.vault.adapter.remove(file);
	}
}

// 원본을 보관하고 백업 파일 이름을 돌려줍니다. 실패하면 null — 백업에 실패했다고 수정 자체를
// 막지는 않습니다(되돌리기는 백업 없이도 동작하므로). 대신 화면에 백업 실패를 알립니다.
export async function saveBackup(
	plugin: IntraCopilotPlugin,
	notePath: string,
	body: string,
): Promise<string | null> {
	const name = `${timestamp()}-${safeName(notePath)}.md`;
	try {
		const dir = backupsDir(plugin);
		if (!(await plugin.app.vault.adapter.exists(dir))) {
			await plugin.app.vault.adapter.mkdir(dir);
		}
		await plugin.app.vault.adapter.write(backupPath(plugin, name), body);
	} catch {
		return null;
	}

	// 오래된 백업 정리는 따로 감쌉니다. 정리에 실패했다고 "보관하지 못했다"고 알리면 안 됩니다
	// — 백업 파일은 이미 잘 써졌고, 정리는 다음 백업 때 다시 시도됩니다.
	try {
		await pruneBackups(plugin);
	} catch {
		/* 다음 백업 때 다시 정리합니다 */
	}
	return name;
}
