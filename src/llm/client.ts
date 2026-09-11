import { requestUrl } from 'obsidian';
import { LlmSettings } from '../settings';

export type LlmTestResult =
	| { ok: true; reply: string }
	| { ok: false; error: string };

interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
}

export type LlmModelsResult =
	| { ok: true; models: string[] }
	| { ok: false; error: string };

interface ModelsListResponse {
	data?: Array<{ id?: string }>;
}

// OpenAI 호환 /chat/completions 엔드포인트로 짧은 테스트 메시지를 보내 연결을 확인합니다.
// 실제 노트 내용은 절대 보내지 않습니다 — 고정된 테스트 문장만 전송합니다.
export async function testLlmConnection(
	settings: LlmSettings,
): Promise<LlmTestResult> {
	const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;

	try {
		const response = await requestUrl({
			url,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(settings.apiKey
					? { Authorization: `Bearer ${settings.apiKey}` }
					: {}),
			},
			body: JSON.stringify({
				model: settings.model,
				messages: [
					{
						role: 'user',
						content: '연결 테스트입니다. "연결 성공"이라고만 답해주세요.',
					},
				],
				max_tokens: 20,
			}),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			return {
				ok: false,
				error: `HTTP ${response.status}: ${response.text.slice(0, 300)}`,
			};
		}

		const data = response.json as ChatCompletionResponse;
		const reply = data.choices?.[0]?.message?.content ?? '(빈 응답)';
		return { ok: true, reply };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// OpenAI 호환 /models 엔드포인트로 서버가 제공하는 모델 이름 목록을 가져옵니다.
export async function listLlmModels(
	settings: Pick<LlmSettings, 'baseUrl' | 'apiKey'>,
): Promise<LlmModelsResult> {
	const url = `${settings.baseUrl.replace(/\/+$/, '')}/models`;

	try {
		const response = await requestUrl({
			url,
			method: 'GET',
			headers: {
				...(settings.apiKey
					? { Authorization: `Bearer ${settings.apiKey}` }
					: {}),
			},
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			return {
				ok: false,
				error: `HTTP ${response.status}: ${response.text.slice(0, 300)}`,
			};
		}

		const data = response.json as ModelsListResponse;
		const models = (data.data ?? [])
			.map((item) => item.id)
			.filter((id): id is string => Boolean(id));
		return { ok: true, models };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
