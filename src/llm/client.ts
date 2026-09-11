import { requestUrl } from 'obsidian';
import { DEFAULT_SETTINGS, LlmSettings, MIN_CHAT_TIMEOUT_SECONDS } from '../settings';

// 서버가 응답을 주지 않고 매달려 있으면 버튼이 "확인 중..."에서, 챗봇은 입력창이
// 잠긴 채로 영원히 멈춥니다. 그래서 정해진 시간이 지나면 실패로 처리합니다.
// 모델 목록 조회/연결 확인은 가벼운 요청이라 짧게, 챗봇 답변은 생성 시간이 길어서 설정값을 씁니다.
const CHECK_TIMEOUT_SECONDS = 30;

class RequestTimeoutError extends Error {
	constructor(readonly seconds: number) {
		super(`Request timed out after ${seconds}s`);
		this.name = 'RequestTimeoutError';
	}
}

// requestUrl에는 타임아웃 옵션이 없어서, 타이머와 경쟁시켜 먼저 끝나는 쪽을 씁니다.
// 주의: 실제 요청 자체를 취소하지는 못하고(서버는 끝까지 답을 만듭니다), UI가 계속
// 기다리지 않게만 해줍니다. 그래서 챗봇 쪽 대기 시간은 넉넉하게 잡습니다.
async function withTimeout<T>(request: Promise<T>, seconds: number): Promise<T> {
	let timer: number | undefined;
	try {
		return await Promise.race([
			request,
			new Promise<never>((_resolve, reject) => {
				timer = window.setTimeout(
					() => reject(new RequestTimeoutError(seconds)),
					seconds * 1000,
				);
			}),
		]);
	} finally {
		if (timer !== undefined) window.clearTimeout(timer);
	}
}

// ─── 실패 원인 분류 ───────────────────────────────────────────────
// 서버가 준 원문(예: "HTTP 404: {...}")만 보여주면 사용자가 무엇을 고쳐야 할지 모릅니다.
// 그래서 실패를 원인별로 나누고, 화면에서는 i18n.ts의 describeLlmError()가
// 원인마다 "무엇이 문제이고 어떻게 고치는지" 안내문을 보여줍니다. 원문은 detail에 남깁니다.
export type LlmErrorKind =
	| 'invalid-url' // 서버 주소 형식이 틀림(http:// 누락 등)
	| 'timeout' // 정해진 시간 안에 응답 없음
	| 'network' // 서버에 아예 닿지 않음(주소 오타, 서버 꺼짐, 사내망 밖)
	| 'certificate' // https 인증서를 신뢰할 수 없음
	| 'auth' // API 키 없음/틀림 (401, 403)
	| 'not-found' // 서버엔 닿았지만 경로가 틀림 (404, /v1 누락 등)
	| 'model' // 모델 이름이 틀렸거나 대화용 모델이 아님
	| 'context-length' // 대화 + 응답 제한이 모델의 최대 길이를 넘음
	| 'rate-limit' // 사용량 제한 (429)
	| 'bad-request' // 그 밖의 요청 거절 (400대)
	| 'server' // 서버 내부 오류 (500대)
	| 'invalid-response' // LLM API가 아닌 응답(웹페이지 등)
	| 'unknown';

export interface LlmFailure {
	ok: false;
	kind: LlmErrorKind;
	detail: string; // 서버/네트워크가 준 원문 — 화면의 "자세한 내용"에 그대로 보여줍니다.
	timeoutSeconds?: number;
}

// HTML 오류 페이지가 오면 태그 덩어리 대신 페이지 제목만 보여줍니다.
function summarizeBody(text: string): string {
	const trimmed = text.trim();
	if (/^<(!doctype|html)/i.test(trimmed)) {
		const title = /<title[^>]*>([^<]*)<\/title>/i.exec(trimmed)?.[1]?.trim();
		return `HTML page${title ? `: ${title}` : ''}`;
	}
	return trimmed.slice(0, 300);
}

// OpenAI 호환 서버들은 오류를 {"error": {"message": "..."}} / {"message": "..."} /
// {"detail": "..."} 등 조금씩 다른 모양으로 줍니다. 사람이 읽을 문장만 꺼냅니다.
function extractServerMessage(text: string): string {
	try {
		const data = JSON.parse(text) as {
			error?: { message?: unknown } | string;
			message?: unknown;
			detail?: unknown;
		};
		const candidate =
			(typeof data.error === 'object' ? data.error?.message : data.error) ??
			data.message ??
			data.detail;
		if (typeof candidate === 'string') return candidate;
		if (candidate !== undefined) return JSON.stringify(candidate).slice(0, 300);
	} catch {
		// JSON이 아니면 아래에서 본문을 그대로 요약합니다.
	}
	return summarizeBody(text);
}

export function classifyHttpError(status: number, body: string): LlmErrorKind {
	const text = body.toLowerCase();
	if (/maximum context length|context_length_exceeded|reduce the length|too many tokens/.test(text)) {
		return 'context-length';
	}
	if (status === 401 || status === 403) return 'auth';
	if (status === 429) return 'rate-limit';
	if (
		text.includes('model_not_found') ||
		(text.includes('model') &&
			/not found|does not exist|not exist|not supported|unsupported|does not support|decommissioned|not available|invalid model/.test(
				text,
			))
	) {
		return 'model';
	}
	if (status === 404) return 'not-found';
	if (status >= 500) return 'server';
	if (status >= 400) return 'bad-request';
	return 'unknown';
}

export function classifyException(error: unknown): LlmErrorKind {
	if (error instanceof RequestTimeoutError) return 'timeout';
	const message = error instanceof Error ? error.message : String(error);
	// "net::ERR_CERT_..."도 net::으로 시작하므로 인증서를 먼저 봅니다.
	if (/cert|ssl|tls/i.test(message)) return 'certificate';
	if (/invalid url|err_invalid_url|unknown_url_scheme|url scheme/i.test(message)) return 'invalid-url';
	if (
		/net::|enotfound|eai_again|econnrefused|econnreset|ehostunreach|enetunreach|etimedout|getaddrinfo|failed to fetch|network/i.test(
			message,
		)
	) {
		return 'network';
	}
	return 'unknown';
}

function httpFailure(status: number, body: string): LlmFailure {
	return {
		ok: false,
		kind: classifyHttpError(status, body),
		detail: `HTTP ${status}: ${extractServerMessage(body)}`,
	};
}

function exceptionFailure(error: unknown): LlmFailure {
	const kind = classifyException(error);
	return {
		ok: false,
		kind,
		detail: error instanceof Error ? error.message : String(error),
		...(error instanceof RequestTimeoutError ? { timeoutSeconds: error.seconds } : {}),
	};
}

// 요청을 보내기 전에 주소 형식부터 확인합니다. "localhost:1234/v1"처럼 http://를 빠뜨리면
// 네트워크 오류가 애매한 문장으로 오기 때문에, 여기서 분명하게 알려줍니다.
function validateBaseUrl(baseUrl: string): LlmFailure | null {
	return /^https?:\/\/[^\s/]+/i.test(baseUrl)
		? null
		: { ok: false, kind: 'invalid-url', detail: baseUrl || '(empty)' };
}

// 2xx인데 본문이 JSON이 아니면(웹페이지 주소를 넣은 경우 등) undefined를 돌려줍니다.
function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function invalidResponse(text: string): LlmFailure {
	return { ok: false, kind: 'invalid-response', detail: summarizeBody(text) || '(empty body)' };
}

// ─── 대화 요청 ──────────────────────────────────────────────────

export type ChatCompletionResult =
	| {
			ok: true;
			reply: string; // 실제 답변(생각 과정 제외). 서버가 빈 답을 주면 ''입니다.
			reasoning: string; // 추론형 모델의 생각 과정. 없으면 ''입니다.
			truncated: boolean; // max_tokens에 걸려 답이 중간에 잘렸으면 true
	  }
	| LlmFailure;

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface ChatCompletionResponse {
	choices?: Array<{
		finish_reason?: string | null;
		message?: {
			content?: string | null;
			// vLLM에서 추론 파서를 켜면 생각 과정이 이 칸으로 따로 옵니다(서버 버전에 따라 이름이 다름).
			reasoning_content?: string | null;
			reasoning?: string | null;
		};
	}>;
}

// Qwen3, DeepSeek-R1 같은 추론형 모델은 답 앞에 <think>...</think>로 생각 과정을 붙여 보내기도 합니다.
// 여는 태그가 서버 쪽 템플릿에 들어가 있어서 닫는 태그(</think>)만 오는 경우도 함께 처리합니다.
export function splitReasoning(content: string): { reasoning: string; answer: string } {
	const OPEN = '<think>';
	const CLOSE = '</think>';
	const trimmed = content.trimStart();
	const hasOpen = trimmed.startsWith(OPEN);
	const body = hasOpen ? trimmed.slice(OPEN.length) : trimmed;
	const closeIndex = body.indexOf(CLOSE);

	if (closeIndex === -1) {
		// 여는 태그만 있고 닫히지 않았다면, 생각하다가 길이 제한에 걸려 끊긴 경우입니다.
		return hasOpen ? { reasoning: body.trim(), answer: '' } : { reasoning: '', answer: content.trim() };
	}
	return {
		reasoning: body.slice(0, closeIndex).trim(),
		answer: body.slice(closeIndex + CLOSE.length).trim(),
	};
}

// 화면에 쌓인 대화를 서버로 보낼 형태로 정리합니다. 사내 서버(vLLM)는 모델마다 채팅 템플릿
// 규칙이 달라서, Mistral·Gemma 계열처럼 "user로 시작하고 user/assistant가 번갈아 나와야 한다"는
// 규칙을 어기면 400 오류를 냅니다. 그래서 어떤 모델이든 통과하는 모양으로 맞춰서 보냅니다.
export function buildRequestMessages(
	settings: Pick<LlmSettings, 'maxHistoryMessages' | 'systemPrompt'>,
	conversation: readonly ChatMessage[],
): ChatMessage[] {
	// 1) user/assistant만 남기고, 저장용으로 붙어 있는 추가 정보(생각 과정 등)는 떼어냅니다.
	let history: ChatMessage[] = conversation
		.filter((message) => message.role !== 'system')
		.map(({ role, content }) => ({ role, content }));

	// 2) 서버 부담을 줄이기 위해 최근 N개만 보냅니다(화면에는 전체가 그대로 남습니다).
	if (settings.maxHistoryMessages > 0) {
		history = history.slice(-settings.maxHistoryMessages);
	}

	// 3) 잘라낸 결과가 assistant로 시작하면 앞에서부터 버려서 반드시 user로 시작하게 합니다.
	while (history.length > 0 && history[0]?.role !== 'user') {
		history.shift();
	}

	// 4) 같은 역할이 연달아 나오면(예전 버전에서 저장된 대화 등) 하나로 합칩니다.
	const merged: ChatMessage[] = [];
	for (const message of history) {
		const last = merged[merged.length - 1];
		if (last && last.role === message.role) {
			last.content = `${last.content}\n\n${message.content}`;
		} else {
			merged.push({ ...message });
		}
	}

	// 5) 기본 지시문(시스템 프롬프트)이 있으면 맨 앞에 붙입니다.
	const systemPrompt = settings.systemPrompt.trim();
	return systemPrompt ? [{ role: 'system', content: systemPrompt }, ...merged] : merged;
}

function authHeader(apiKey: string): Record<string, string> {
	return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

// /chat/completions 호출을 한 곳에 모아둔 내부 함수입니다.
// testLlmConnection(고정 테스트 문장)과 sendChatMessage(실제 대화)가 이걸 함께 씁니다.
async function postChatCompletion(
	settings: LlmSettings,
	messages: ChatMessage[],
	maxTokens: number | undefined,
	timeoutSeconds: number,
): Promise<ChatCompletionResult> {
	const invalidUrl = validateBaseUrl(settings.baseUrl);
	if (invalidUrl) return invalidUrl;

	try {
		const response = await withTimeout(
			requestUrl({
				url: joinUrl(settings.baseUrl, '/chat/completions'),
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...authHeader(settings.apiKey),
				},
				body: JSON.stringify({
					model: settings.model,
					messages,
					...(maxTokens ? { max_tokens: maxTokens } : {}),
				}),
				throw: false,
			}),
			timeoutSeconds,
		);

		if (response.status < 200 || response.status >= 300) {
			return httpFailure(response.status, response.text);
		}

		const data = parseJson(response.text) as ChatCompletionResponse | undefined;
		if (!data || !Array.isArray(data.choices)) {
			return invalidResponse(response.text);
		}

		const choice = data.choices[0];
		const { reasoning: inlineReasoning, answer } = splitReasoning(choice?.message?.content ?? '');
		const separateReasoning = (
			choice?.message?.reasoning_content ??
			choice?.message?.reasoning ??
			''
		).trim();

		return {
			ok: true,
			reply: answer,
			reasoning: separateReasoning || inlineReasoning,
			truncated: choice?.finish_reason === 'length',
		};
	} catch (error) {
		return exceptionFailure(error);
	}
}

export type LlmModelsResult = { ok: true; models: string[] } | LlmFailure;

interface ModelsListResponse {
	data?: Array<{ id?: string }>;
}

// OpenAI 호환 /chat/completions 엔드포인트로 짧은 테스트 메시지를 보내 연결을 확인합니다.
// 실제 노트 내용은 절대 보내지 않습니다 — 고정된 테스트 문장만 전송합니다.
// (시스템 프롬프트나 대화 기록도 붙이지 않습니다.)
export async function testLlmConnection(
	settings: LlmSettings,
): Promise<ChatCompletionResult> {
	return postChatCompletion(
		settings,
		[
			{
				role: 'user',
				content: '연결 테스트입니다. "연결 성공"이라고만 답해주세요.',
			},
		],
		20,
		CHECK_TIMEOUT_SECONDS,
	);
}

// 챗봇 사이드바에서 실제 대화를 보낼 때 씁니다. conversation은 지금까지의 대화 전체입니다.
// 노트 내용은 자동으로 포함되지 않습니다 — 사용자가 채팅창에 입력한 것만 전송됩니다.
// 사내 공용 서버 부담을 줄이기 위해 최근 대화만 보내고(buildRequestMessages 참고),
// 응답 길이도 설정된 만큼으로 제한합니다.
export async function sendChatMessage(
	settings: LlmSettings,
	conversation: readonly ChatMessage[],
): Promise<ChatCompletionResult> {
	const maxTokens = settings.maxResponseTokens > 0 ? settings.maxResponseTokens : undefined;
	const timeoutSeconds =
		settings.chatTimeoutSeconds >= MIN_CHAT_TIMEOUT_SECONDS
			? settings.chatTimeoutSeconds
			: DEFAULT_SETTINGS.llm.chatTimeoutSeconds;
	return postChatCompletion(
		settings,
		buildRequestMessages(settings, conversation),
		maxTokens,
		timeoutSeconds,
	);
}

// OpenAI 호환 /models 엔드포인트로 서버가 제공하는 모델 이름 목록을 가져옵니다.
export async function listLlmModels(
	settings: Pick<LlmSettings, 'baseUrl' | 'apiKey'>,
): Promise<LlmModelsResult> {
	const invalidUrl = validateBaseUrl(settings.baseUrl);
	if (invalidUrl) return invalidUrl;

	try {
		const response = await withTimeout(
			requestUrl({
				url: joinUrl(settings.baseUrl, '/models'),
				method: 'GET',
				headers: authHeader(settings.apiKey),
				throw: false,
			}),
			CHECK_TIMEOUT_SECONDS,
		);

		if (response.status < 200 || response.status >= 300) {
			return httpFailure(response.status, response.text);
		}

		const data = parseJson(response.text) as ModelsListResponse | undefined;
		if (!data || !Array.isArray(data.data)) {
			return invalidResponse(response.text);
		}

		const models = data.data
			.map((item) => item.id)
			.filter((id): id is string => Boolean(id));
		return { ok: true, models };
	} catch (error) {
		return exceptionFailure(error);
	}
}
