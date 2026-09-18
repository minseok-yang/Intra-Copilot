// 제너레이터 [파일에서 텍스트 가져오기]의 .txt·.eml 파일을 텍스트로 바꿉니다.
// 파일 바이트는 PowerShell이 읽어 넘겨주고(파일 경로는 PowerShell 안에서만 오갑니다), 여기서는 바이트만
// 다루므로 Obsidian 없이 돌아갑니다(npm test).

// 텍스트 파일의 인코딩을 맞춰 읽습니다. UTF-16 BOM이 있으면 그대로 따르고, 아니면 UTF-8로 엄격하게 읽어 보고
// 깨진 바이트가 나오면 한국어 Windows에서 흔한 CP949(EUC-KR)로 다시 읽습니다. UTF-8 BOM은 TextDecoder가 뗍니다.
export function decodeText(bytes: Uint8Array): string {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder('euc-kr').decode(bytes);
	}
}

// 메일 원문은 바이트를 한 글자씩 담은 문자열(latin1)로 다룹니다. 구조(머리말·경계선)는 ASCII라 그대로 찾고,
// 본문 조각만 바이트로 되돌려 그 조각의 문자셋으로 읽습니다.
function toBinary(bytes: Uint8Array): string {
	let text = '';
	for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return text;
}

function fromBinary(text: string): Uint8Array {
	return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

// 메일에 적힌 문자셋으로 읽습니다. 적힌 것이 없거나 UTF-8·ASCII라고만 적혀 있으면(실제로는 CP949인 메일이
// 있어서) 텍스트 파일과 같은 방식으로 판별합니다.
function decodeWith(bytes: Uint8Array, charset: string | undefined): string {
	const label = charset?.trim().toLowerCase();
	if (label && !/^(us-ascii|utf-?8)$/.test(label)) {
		try {
			return new TextDecoder(label).decode(bytes);
		} catch {
			// 모르는 문자셋이면 아래 판별로 넘어갑니다.
		}
	}
	return decodeText(bytes);
}

function fromBase64(text: string): string {
	try {
		return atob(text.replace(/[^A-Za-z0-9+/]/g, ''));
	} catch {
		return '';
	}
}

function fromQuotedPrintable(text: string): string {
	return text
		.replace(/=\r?\n/g, '')
		.replace(/=([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

// 머리말 값: 날 바이트(UTF-8 등)를 먼저 글자로 읽고, =?문자셋?B|Q?...?= 형태로 감싼 부분을 풉니다.
// 감싼 부분끼리 붙어 있으면 그 사이 공백은 버리는 것이 규칙입니다(RFC 2047).
function decodeHeader(raw: string): string {
	return decodeText(fromBinary(raw))
		.replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?)/gi, '$1')
		.replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bq])\?([^?]*)\?=/gi, (_, charset: string, kind: string, text: string) => {
			const binary = kind.toLowerCase() === 'b' ? fromBase64(text) : fromQuotedPrintable(text.replace(/_/g, ' '));
			return decodeWith(fromBinary(binary), charset);
		});
}

interface Part {
	headers: Map<string, string>;
	body: string;
}

function splitPart(raw: string): Part {
	const headers = new Map<string, string>();
	// 빈 줄로 시작하면 머리말이 없는 조각입니다.
	const leading = /^\r?\n/.exec(raw);
	if (leading) return { headers, body: raw.slice(leading[0].length) };
	const gap = /\r?\n\r?\n/.exec(raw);
	const head = gap ? raw.slice(0, gap.index) : raw;
	for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
		const colon = line.indexOf(':');
		if (colon <= 0) continue;
		const key = line.slice(0, colon).trim().toLowerCase();
		if (!headers.has(key)) headers.set(key, line.slice(colon + 1).trim());
	}
	return { headers, body: gap ? raw.slice(gap.index + gap[0].length) : '' };
}

// Content-Type·Content-Disposition의 name=값을 글자로 풀어 읽습니다. =?UTF-8?B?...?= 형태와
// filename*=UTF-8''%ED%95%9C 같은 형태(RFC 2231) 모두 풉니다.
// ponytail: filename*0*= 처럼 여러 줄로 나눈 긴 이름은 읽지 않습니다. 첨부 이름이 비어 보이는 메일이 나오면 추가하세요.
function param(value: string | undefined, name: string): string | undefined {
	const match = new RegExp(`(?:^|;)\\s*${name}(\\*?)=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(value ?? '');
	if (!match) return undefined;
	const text = match[2] ?? match[3] ?? '';
	const extended = match[1] ? /^([^']*)'[^']*'(.*)$/.exec(text) : null;
	if (!extended) return decodeHeader(text);
	const binary = (extended[2] ?? '').replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
	return decodeWith(fromBinary(binary), extended[1]);
}

// ponytail: 메일 서명·뉴스레터에 흔한 이름만 둡니다(HTML 전체 표는 2천여 개). 원문 그대로 보이는 이름이 나오면 추가하세요.
const ENTITIES: Record<string, string> = {
	nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'",
	mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•',
	lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
	copy: '©', reg: '®', trade: '™', deg: '°', times: '×', divide: '÷',
	euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
	larr: '←', rarr: '→', uarr: '↑', darr: '↓',
};

// HTML 메일 본문을 읽을 수 있는 텍스트로 바꿉니다. 모양은 버리고 줄바꿈과 표 칸만 남깁니다.
function htmlToText(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(head|style|script)\b[\s\S]*?<\/\1\s*>/gi, '')
		.replace(/\s+/g, ' ')
		.replace(/<br\b[^>]*>/gi, '\n')
		.replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, '\n')
		.replace(/<\/t[dh]\s*>/gi, '\t')
		.replace(/<[^>]*>/g, '')
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
			if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
			const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
		})
		.replace(/[ \t]*\n[ \t]*/g, '\n');
}

interface Collected {
	plain: string[];
	html: string[];
	attachments: string[];
}

function collect({ headers, body }: Part, out: Collected, depth: number): void {
	const contentType = headers.get('content-type');
	const type = (contentType ?? 'text/plain').split(';')[0]?.trim().toLowerCase() ?? 'text/plain';
	const disposition = headers.get('content-disposition');

	if (type.startsWith('multipart/')) {
		const boundary = param(contentType, 'boundary');
		if (!boundary || depth > 10) return;
		// 첫 조각은 경계선 앞 머리글이고, "--"로 시작하는 조각은 끝 표시 뒤라 읽지 않습니다.
		for (const piece of body.split(`--${boundary}`).slice(1)) {
			if (piece.startsWith('--')) break;
			collect(splitPart(piece.replace(/^[ \t]*\r?\n/, '')), out, depth + 1);
		}
		return;
	}

	// 본문으로 읽을 수 없는 조각(이름 없이 본문에 끼운 이미지 등)도 있었다는 흔적은 첨부 줄에 남깁니다.
	const filename = param(disposition, 'filename') ?? param(contentType, 'name');
	const isBody = type === 'text/plain' || type === 'text/html';
	if (/^\s*attachment/i.test(disposition ?? '') || filename !== undefined || !isBody) {
		out.attachments.push(filename || type);
		return;
	}

	const encoding = headers.get('content-transfer-encoding')?.trim().toLowerCase();
	const binary = encoding === 'base64' ? fromBase64(body) : encoding === 'quoted-printable' ? fromQuotedPrintable(body) : body;
	const text = decodeWith(fromBinary(binary), param(contentType, 'charset'));
	if (type === 'text/html') out.html.push(htmlToText(text));
	else out.plain.push(text);
}

// .eml 파일을 Outlook에서 가져온 메일과 같은 모양(제목·보낸 사람·받는 사람·받은 시각·첨부 + 본문)으로 바꿉니다.
// 본문은 일반 텍스트가 있으면 그것을, 없으면 HTML에서 글자만 뽑아 씁니다. 첨부는 이름만 적습니다.
export function emlToText(bytes: Uint8Array): string {
	const top = splitPart(toBinary(bytes));
	const { headers } = top;
	const out: Collected = { plain: [], html: [], attachments: [] };
	collect(top, out, 0);

	const lines = [`제목: ${decodeHeader(headers.get('subject') ?? '')}`];
	const fields: [string, string][] = [
		['보낸 사람', 'from'],
		['받는 사람', 'to'],
		['받은 시각', 'date'],
	];
	for (const [label, key] of fields) {
		const value = decodeHeader(headers.get(key) ?? '');
		if (value) lines.push(`${label}: ${value}`);
	}
	if (out.attachments.length > 0) lines.push(`첨부: ${out.attachments.join(', ')}`);
	const body = (out.plain.length > 0 ? out.plain : out.html).join('\n\n');
	return `${lines.join('\n')}\n\n${body}`;
}
