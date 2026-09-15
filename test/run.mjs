// 링크 모듈 테스트 실행기: test/*.test.ts를 하나씩 번들해 Node로 돌립니다(npm test).
// Obsidian 없이 돌리기 위해 'obsidian' 모듈을 test/obsidian-mock.ts로 바꿔 끼웁니다.
// 번들 결과는 운영체제 임시 폴더에 두어 저장소에 남지 않게 합니다.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
let failed = false;
for (const name of readdirSync(dir).filter((file) => file.endsWith('.test.ts'))) {
	const outfile = join(tmpdir(), `intra-copilot-${name}.cjs`);
	await build({
		entryPoints: [join(dir, name)],
		bundle: true,
		platform: 'node',
		outfile,
		alias: { obsidian: join(dir, 'obsidian-mock.ts') },
		logLevel: 'warning',
	});
	console.log(`\n▶ ${name}`);
	const { status } = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
	if (status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
