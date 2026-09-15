import type { StatusState } from '../ui/status-light';

// 챗봇 상단 상태등이 보여주는 "서버 연결 상태"입니다.
// 모든 확인(모델 목록 조회, 연결 확인, 실제 대화)이 결과를 여기에 기록하고,
// 상태등은 이 값을 보여줍니다.
//
// 결과의 출처(source)
// - 'models': 모델 목록 조회 — 서버에 닿는지만 알 수 있음
// - 'chat'  : 연결 확인 또는 실제 대화 — 선택한 모델이 실제로 답하는지까지 알 수 있음
//
// 녹색은 "선택한 모델이 실제로 답했다"는 뜻입니다. 그래서 목록 조회 성공만으로는
// 녹색을 켜지 않습니다. 목록에 이름이 있어도 대화용이 아닌 모델(음성·임베딩 등)이면
// 대화가 실패하기 때문입니다. 목록 조회 실패(서버에 안 닿음)는 빨간색으로 기록합니다.
export type ConnectionSource = 'models' | 'chat';

export interface ConnectionStatus {
	state: StatusState;
	message: string; // ''이면 아직 아무 확인도 하지 않은 상태
	checkedAt: Date | null; // 마지막으로 성공/실패 결과가 나온 시각
	source: ConnectionSource | null; // null이면 설정이 바뀌어 아직 확인 전
	detail?: string; // 서버 원문(설정 화면 상태등에 마우스를 올리면 보임)
}

export class ConnectionStatusStore {
	private status: ConnectionStatus = {
		state: 'idle',
		message: '',
		checkedAt: null,
		source: null,
	};
	private listeners = new Set<() => void>();
	// 지금 진행 중인 확인 수. 챗봇 머리줄과 설정 화면이 같은 "확인 중"을 보여 주도록 여기서 셉니다.
	private pending = 0;

	get(): ConnectionStatus {
		return this.status;
	}

	isChecking(): boolean {
		return this.pending > 0;
	}

	// 확인 작업을 감싸 끝날 때까지 "확인 중"으로 둡니다. 겹쳐 시작해도 마지막 것이 끝나야 풀립니다.
	async track<T>(work: () => Promise<T>): Promise<T> {
		this.pending++;
		this.notify();
		try {
			return await work();
		} finally {
			this.pending--;
			this.notify();
		}
	}

	// 서버 주소·키·모델이 바뀌었을 때: 이전 결과는 더 이상 믿을 수 없으므로 회색(확인 필요)으로.
	markChanged(message: string): void {
		this.update({ ...this.status, state: 'idle', message, source: null, detail: undefined });
	}

	record(source: ConnectionSource, state: StatusState, message: string, detail?: string): void {
		if (source === 'models' && state === 'ok') {
			// 목록 조회 성공만으로는 녹색을 켜지 않습니다(위 설명 참고). 이미 대화로 녹색이 됐다면
			// 그대로 두고, 아니면 "목록은 확인됨, 연결 확인은 아직" 상태를 회색으로 알려줍니다.
			if (this.status.source === 'chat' && this.status.state === 'ok') return;
			state = 'idle';
		}
		this.update({
			state,
			message,
			checkedAt: state === 'idle' ? this.status.checkedAt : new Date(),
			source,
			detail,
		});
	}

	// 상태가 바뀔 때마다 불릴 함수를 등록합니다. 돌려받은 함수를 부르면 등록이 풀립니다.
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private update(next: ConnectionStatus): void {
		this.status = next;
		this.notify();
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}
