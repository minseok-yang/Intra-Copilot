import { Buffer } from 'buffer';
import * as http from 'http';
import { requestUrl } from 'obsidian';
import type { LlmSettings } from '../settings';

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

class RequestCancelledError extends Error {
	constructor() {
		super('Cancelled by the user');
		this.name = 'RequestCancelledError';
	}
}

// ─── 요청을 보내는 유일한 통로 ─────────────────────────────────────────
// 이 파일 밖에서는 네트워크 요청을 보내지 않습니다. 모든 요청이 sendHttp()를 거치고,
// 목적지는 설정에 입력한 서버 주소 하나뿐입니다. (주소를 사내 대역으로 제한하는 검사는 두지 않습니다 —
// 사내에서는 회사 방화벽이 외부 연결을 막고, 집에서는 Groq 같은 외부 API로 테스트하기 때문입니다.)
//
// http://와 https://를 다르게 보냅니다.
// - http://  → Node 내장 http 모듈. ① 서버가 다른 주소로 넘겨도(리다이렉트) 따라가지 않고,
//              ② [중지]·시간 초과 때 연결을 실제로 끊습니다
//              (서버가 연결 끊김을 감지하면 답변 생성을 멈출 수 있음 — vLLM 버전에 따라 확인 필요).
// - https:// → Obsidian의 requestUrl. 회사 자체 인증서를 Windows 인증서 저장소에서 읽어 신뢰하기
//              때문입니다(Node는 이 저장소를 읽지 못할 수 있음). 대신 리다이렉트를 막을 방법이 없고
//              [중지]해도 요청이 끝까지 진행됩니다.

interface HttpInit {
	method: 'GET' | 'POST';
	headers: Record<string, string>;
	body?: string;
}

interface HttpResult {
	status: number;
	text: string;
	location?: string; // 리다이렉트 응답일 때 서버가 넘기려던 주소
}

// 작업이 끝나거나, signal이 중단되는 것 중 먼저 오는 쪽으로 끝납니다(중단 사유로 실패).
function untilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			const reason: unknown = signal.reason;
			reject(reason instanceof Error ? reason : new Error(String(reason)));
		};
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener('abort', onAbort, { once: true });
		void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}

function nodeHttpRequest(target: URL, init: HttpInit, signal: AbortSignal): Promise<HttpResult> {
	return new Promise<HttpResult>((resolve, reject) => {
		const body = init.body === undefined ? undefined : Buffer.from(init.body, 'utf8');
		const request = http.request(
			{
				// URL 속 IPv6 주소는 [::1]처럼 대괄호가 붙어 있어서 떼고 넘깁니다.
				hostname: target.hostname.replace(/^\[|\]$/g, ''),
				port: target.port || 80,
				path: `${target.pathname}${target.search}`,
				method: init.method,
				headers: {
					...init.headers,
					Host: target.host,
					...(body ? { 'Content-Length': String(body.length) } : {}),
				},
				signal,
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on('data', (chunk: Buffer) => chunks.push(chunk));
				response.on('end', () =>
					resolve({
						status: response.statusCode ?? 0,
						text: Buffer.concat(chunks).toString('utf8'),
						location: response.headers.location,
					}),
				);
				response.on('error', reject);
			},
		);
		request.on('error', reject);
		request.end(body);
	});
}

async function sendHttp(
	url: string,
	init: HttpInit,
	timeoutSeconds: number,
	cancelSignal?: AbortSignal,
): Promise<HttpResult> {
	const controller = new AbortController();
	const timer = window.setTimeout(
		() => controller.abort(new RequestTimeoutError(timeoutSeconds)),
		timeoutSeconds * 1000,
	);
	const onCancel = () => controller.abort(new RequestCancelledError());
	if (cancelSignal?.aborted) onCancel();
	cancelSignal?.addEventListener('abort', onCancel, { once: true });

	try {
		return await untilAborted(
			controller.signal,
			(async () => {
				const target = new URL(url);
				if (target.protocol === 'http:') {
					return nodeHttpRequest(target, init, controller.signal);
				}
				const response = await requestUrl({
					url,
					method: init.method,
					headers: init.headers,
					body: init.body,
					throw: false,
				});
				return { status: response.status, text: response.text };
			})(),
		);
	} finally {
		window.clearTimeout(timer);
		cancelSignal?.removeEventListener('abort', onCancel);
	}
}

// ─── 실패 원인 분류 ───────────────────────────────────────────────
// 서버가 준 원문(예: "HTTP 404: {...}")만 보여주면 사용자가 무엇을 고쳐야 할지 모릅니다.
// 그래서 실패를 원인별로 나누고, 화면에서는 i18n.ts의 describeLlmError()가
// 원인마다 "무엇이 문제이고 어떻게 고치는지" 안내문을 보여줍니다. 원문은 detail에 남깁니다.
export type LlmErrorKind =
	| 'invalid-url' // 서버 주소 형식이 틀림(http:// 누락 등)
	| 'redirect' // 서버가 다른 주소로 넘기려 해서 따라가지 않음
	| 'timeout' // 정해진 시간 안에 응답 없음
	| 'cancelled' // 사용자가 [중지]를 누름
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

function classifyHttpError(status: number, body: string): LlmErrorKind {
	if (status >= 300 && status < 400) return 'redirect';
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

function classifyException(error: unknown): LlmErrorKind {
	if (error instanceof RequestTimeoutError) return 'timeout';
	if (error instanceof RequestCancelledError) return 'cancelled';
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

function httpFailure({ status, text, location }: HttpResult): LlmFailure {
	return {
		ok: false,
		kind: classifyHttpError(status, text),
		detail: location
			? `HTTP ${status} → ${location}`
			: `HTTP ${status}: ${extractServerMessage(text)}`,
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
function splitReasoning(content: string): { reasoning: string; answer: string } {
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

	// 5) 시스템 프롬프트가 있으면 맨 앞에 붙입니다.
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
	cancelSignal?: AbortSignal,
): Promise<ChatCompletionResult> {
	const invalidUrl = validateBaseUrl(settings.baseUrl);
	if (invalidUrl) return invalidUrl;

	try {
		const response = await sendHttp(
			joinUrl(settings.baseUrl, '/chat/completions'),
			{
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
			},
			timeoutSeconds,
			cancelSignal,
		);

		if (response.status < 200 || response.status >= 300) {
			return httpFailure(response);
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

// ─── 스트리밍(답변 조각 받기) ────────────────────────────────────────
// 서버가 답변을 다 만들 때까지 기다리지 않고, 만들어지는 대로 조각(SSE: "data: {...}" 줄)을 받습니다.
// 여기서만 fetch를 씁니다 — requestUrl은 응답을 다 받은 뒤에야 돌려주므로 조각을 받을 수 없습니다.
// (그래서 "fetch 대신 requestUrl을 쓰라"는 lint 경고가 이 줄에서 하나 납니다. 스트리밍을 포기하지
//  않는 한 피할 수 없어 그대로 둡니다. 조각을 하나도 못 받으면 아래에서 requestUrl 방식으로 되돌립니다.)
// 리다이렉트는 따라가지 않고(redirect: 'manual'), [중지]·시간 초과 때 연결을 실제로 끊습니다.

export interface StreamProgress {
	answer: string; // 지금까지 받은 답변(생각 과정 제외)
	reasoning: string; // 지금까지 받은 생각 과정
}

interface StreamChunk {
	choices?: Array<{
		finish_reason?: string | null;
		delta?: {
			content?: string | null;
			reasoning_content?: string | null;
			reasoning?: string | null;
		};
	}>;
}

// received가 false면 한 조각도 받지 못한 것입니다(스트리밍이 막힌 환경일 수 있어 부르는 쪽에서 되돌립니다).
async function streamChatCompletion(
	settings: LlmSettings,
	messages: ChatMessage[],
	maxTokens: number | undefined,
	timeoutSeconds: number,
	cancelSignal: AbortSignal | undefined,
	onProgress: (progress: StreamProgress) => void,
): Promise<{ result: ChatCompletionResult; received: boolean }> {
	const invalidUrl = validateBaseUrl(settings.baseUrl);
	if (invalidUrl) return { result: invalidUrl, received: false };

	const controller = new AbortController();
	// 스트리밍에서는 "전체 시간"이 아니라 "조각이 끊긴 시간"을 잽니다. 긴 답변이 천천히 오는 것은
	// 정상이지만, 아무것도 오지 않는 채로 오래 있으면 서버가 멈춘 것이기 때문입니다.
	let idleTimer = 0;
	const resetIdleTimer = () => {
		window.clearTimeout(idleTimer);
		idleTimer = window.setTimeout(
			() => controller.abort(new RequestTimeoutError(timeoutSeconds)),
			timeoutSeconds * 1000,
		);
	};
	const onCancel = () => controller.abort(new RequestCancelledError());
	if (cancelSignal?.aborted) onCancel();
	cancelSignal?.addEventListener('abort', onCancel, { once: true });
	resetIdleTimer();

	let received = false;
	try {
		const response = await fetch(joinUrl(settings.baseUrl, '/chat/completions'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...authHeader(settings.apiKey) },
			body: JSON.stringify({
				model: settings.model,
				messages,
				stream: true,
				...(maxTokens ? { max_tokens: maxTokens } : {}),
			}),
			signal: controller.signal,
			redirect: 'manual',
		});

		if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
			return { result: { ok: false, kind: 'redirect', detail: `HTTP ${response.status}` }, received };
		}
		if (!response.ok) {
			return { result: httpFailure({ status: response.status, text: await response.text() }), received };
		}
		if (!response.body) {
			return { result: invalidResponse('(empty body)'), received };
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let raw = ''; // 서버가 보낸 답변 원문(<think> 포함 가능)
		let reasoning = ''; // 따로 오는 생각 과정
		let finishReason = '';

		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			resetIdleTimer();
			buffer += decoder.decode(value, { stream: true });

			let lineEnd: number;
			while ((lineEnd = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, lineEnd).trim();
				buffer = buffer.slice(lineEnd + 1);
				if (!line.startsWith('data:')) continue; // 주석(:)·빈 줄·event: 줄은 무시
				const payload = line.slice('data:'.length).trim();
				if (payload === '[DONE]') continue;

				const chunk = parseJson(payload) as StreamChunk | undefined;
				const choice = chunk?.choices?.[0];
				if (!choice) continue;
				received = true;
				raw += choice.delta?.content ?? '';
				reasoning += choice.delta?.reasoning_content ?? choice.delta?.reasoning ?? '';
				if (choice.finish_reason) finishReason = choice.finish_reason;
			}

			// 화면에는 <think>를 뗀 답변만 보여줍니다(조각마다 다시 나누므로 중간에도 정확합니다).
			const split = splitReasoning(raw);
			onProgress({ answer: split.answer, reasoning: reasoning.trim() || split.reasoning });
		}

		// 200이지만 조각이 하나도 없었다면(스트리밍을 지원하지 않아 일반 JSON을 보낸 서버 등)
		// 빈 답변을 성공으로 처리하지 않고 실패로 봅니다 — 부르는 쪽이 예전 방식으로 다시 시도합니다.
		if (!received) {
			return { result: invalidResponse(buffer || '(no stream chunks)'), received: false };
		}

		const { reasoning: inlineReasoning, answer } = splitReasoning(raw);
		return {
			result: {
				ok: true,
				reply: answer,
				reasoning: reasoning.trim() || inlineReasoning,
				truncated: finishReason === 'length',
			},
			received,
		};
	} catch (error) {
		// 우리가 끊은 경우(중지·시간 초과)에는 브라우저가 주는 오류 대신 끊은 이유로 분류합니다.
		// 그러지 않으면 [중지]가 "알 수 없는 실패"로 보여서 상태등까지 빨갛게 됩니다.
		return {
			result: exceptionFailure(controller.signal.aborted ? controller.signal.reason : error),
			received,
		};
	} finally {
		window.clearTimeout(idleTimer);
		cancelSignal?.removeEventListener('abort', onCancel);
	}
}

// 챗봇 사이드바에서 실제 대화를 보낼 때 씁니다. conversation은 지금까지의 대화 전체입니다.
// 노트 내용은 사용자가 입력칸에서 @로 직접 지정한 폴더·노트만, 마지막 질문에 붙어서 전송됩니다
// (chat/vault-context.ts의 composeRequestConversation 참고). 그 밖의 노트는 보내지 않습니다.
// 사내 공용 서버 부담을 줄이기 위해 최근 대화만 보내고(buildRequestMessages 참고),
// 응답 길이도 설정된 만큼으로 제한합니다. cancelSignal을 중단하면 [중지]로 처리됩니다.
// onProgress를 주고 설정에서 스트리밍이 켜져 있으면 조각을 받아가며 알려줍니다.
export async function sendChatMessage(
	settings: LlmSettings,
	conversation: readonly ChatMessage[],
	cancelSignal?: AbortSignal,
	onProgress?: (progress: StreamProgress) => void,
): Promise<ChatCompletionResult> {
	const maxTokens = settings.maxResponseTokens > 0 ? settings.maxResponseTokens : undefined;
	const messages = buildRequestMessages(settings, conversation);
	const timeoutSeconds = settings.chatTimeoutSeconds; // 불러올 때·입력할 때 이미 범위를 맞춰 둡니다.

	if (settings.streaming && onProgress) {
		const { result, received } = await streamChatCompletion(
			settings,
			messages,
			maxTokens,
			timeoutSeconds,
			cancelSignal,
			onProgress,
		);
		// 사용자가 [중지]를 눌렀다면 절대 다시 보내지 않습니다(공용 서버에 같은 질문이 두 번 가지 않도록).
		if (cancelSignal?.aborted) return result;
		// 조각을 하나라도 받았거나, 원인이 분명한 실패(인증·모델·서버 거절 등)면 그대로 알립니다.
		// 아무것도 못 받고 연결 단계에서 막힌 경우만, 스트리밍을 막는 서버·환경일 수 있으므로
		// 예전 방식(한 번에 받기)으로 조용히 한 번 더 시도합니다.
		const transportFailure =
			!result.ok && (result.kind === 'network' || result.kind === 'invalid-response' || result.kind === 'unknown');
		if (result.ok || received || !transportFailure) return result;
	}

	return postChatCompletion(settings, messages, maxTokens, timeoutSeconds, cancelSignal);
}

// ─── 임베딩 요청(링크) ───────────────────────────────────────────
// 글 여러 개를 한 번에 보내 글마다 숫자 목록(벡터)을 받습니다. 사내 API, llama-server·Ollama·vLLM 같은
// 자체 서버, Gemini 같은 클라우드 모두 OpenAI 호환 /embeddings 모양이라 이 함수 하나로 붙습니다.
// 느린 PC에서 돌리는 자체 서버는 조각 여러 개를 계산하는 데 오래 걸릴 수 있어 연결 확인보다 넉넉히 기다립니다.
const EMBEDDING_TIMEOUT_SECONDS = 120;

export type EmbeddingResult = { ok: true; vectors: number[][] } | LlmFailure;

interface EmbeddingResponse {
	data?: Array<{ index?: number; embedding?: unknown }>;
}

export async function createEmbeddings(
	// dimensions: 0보다 크면 그 크기의 벡터를 요청합니다(지원하는 모델만, 예: Gemini·OpenAI text-embedding-3).
	server: { baseUrl: string; apiKey: string; model: string; dimensions?: number },
	inputs: string[],
): Promise<EmbeddingResult> {
	const invalidUrl = validateBaseUrl(server.baseUrl);
	if (invalidUrl) return invalidUrl;

	try {
		const response = await sendHttp(
			joinUrl(server.baseUrl, '/embeddings'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...authHeader(server.apiKey) },
				body: JSON.stringify({
					model: server.model,
					input: inputs,
					...(server.dimensions ? { dimensions: server.dimensions } : {}),
				}),
			},
			EMBEDDING_TIMEOUT_SECONDS,
		);
		if (response.status < 200 || response.status >= 300) {
			return httpFailure(response);
		}

		const data = parseJson(response.text) as EmbeddingResponse | undefined;
		// 서버마다 순서를 보장하지 않을 수 있어 index로 맞추고, 보낸 개수만큼 숫자 목록이 왔는지 확인합니다.
		const items = Array.isArray(data?.data) ? [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) : [];
		const vectors = items.map((item) => item.embedding);
		const valid =
			vectors.length === inputs.length &&
			vectors.every((vector) => Array.isArray(vector) && vector.length > 0 && typeof vector[0] === 'number');
		return valid ? { ok: true, vectors: vectors as number[][] } : invalidResponse(response.text);
	} catch (error) {
		return exceptionFailure(error);
	}
}

// OpenAI 호환 /models 엔드포인트로 서버가 제공하는 모델 이름 목록을 가져옵니다.
export async function listLlmModels(
	settings: Pick<LlmSettings, 'baseUrl' | 'apiKey'>,
): Promise<LlmModelsResult> {
	const invalidUrl = validateBaseUrl(settings.baseUrl);
	if (invalidUrl) return invalidUrl;

	try {
		const response = await sendHttp(
			joinUrl(settings.baseUrl, '/models'),
			{ method: 'GET', headers: authHeader(settings.apiKey) },
			CHECK_TIMEOUT_SECONDS,
		);

		if (response.status < 200 || response.status >= 300) {
			return httpFailure(response);
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
