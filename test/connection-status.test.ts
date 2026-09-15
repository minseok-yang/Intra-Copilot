import assert from 'node:assert';
import { ConnectionStatusStore } from '../src/llm/connection-status';

// 챗봇 머리줄과 설정 화면이 같은 기록을 봅니다: "확인 중"은 겹친 확인이 모두 끝나야 풀리고, 결과·원문이 함께 남습니다.
async function main() {
	const store = new ConnectionStatusStore();
	let notified = 0;
	store.subscribe(() => notified++);

	let finishA!: () => void;
	let finishB!: () => void;
	const a = store.track(() => new Promise<void>((resolve) => (finishA = resolve)));
	const b = store.track(() => new Promise<void>((resolve) => (finishB = resolve)));
	assert.ok(store.isChecking());
	finishA();
	await a;
	assert.ok(store.isChecking(), 'older check ended the newer one');
	finishB();
	await b;
	assert.ok(!store.isChecking());
	assert.ok(notified >= 4, 'screens not told about checking changes');

	// 실패해도 "확인 중"은 풀립니다.
	await assert.rejects(store.track(() => Promise.reject(new Error('boom'))));
	assert.ok(!store.isChecking());

	store.record('chat', 'error', 'bad', 'raw server text');
	assert.strictEqual(store.get().detail, 'raw server text');
	store.record('models', 'ok', 'list ok');
	assert.strictEqual(store.get().state, 'idle', 'model list alone turned green');
	store.record('chat', 'ok', 'answered');
	store.record('models', 'ok', 'list ok');
	assert.strictEqual(store.get().state, 'ok', 'model list erased a real answer');
	store.markChanged('model changed');
	assert.deepStrictEqual([store.get().state, store.get().detail], ['idle', undefined]);
	console.log('connection status ok');
}

void main().catch((error) => {
	console.error(error);
	process.exit(1);
});
