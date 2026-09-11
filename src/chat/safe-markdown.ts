// LLM 답변을 마크다운으로 그리기 전/후에 쓰는 안전장치입니다.
//
// 왜 필요한가: 답변은 우리가 통제할 수 없는 글입니다. 그대로 그리면 두 가지 일이 생길 수 있습니다.
// 1) 외부 요청: ![](http://어딘가/그림.png) 같은 이미지나 <img>, style="background:url(...)" 같은
//    HTML은 화면에 그리는 순간 그 주소로 자동 요청을 보냅니다. 나중에 노트를 문맥으로 넣는 기능이
//    생기면 "주소에 노트 내용을 실어 보내는" 반출 경로가 될 수 있습니다.
// 2) 다른 플러그인의 코드 실행: Obsidian은 답변도 노트와 같은 방식으로 그리기 때문에, 설치된 다른
//    플러그인(예: Dataview)이 ```dataviewjs 블록이나 `$= ...` 인라인 코드를 보면 그 코드를 실행합니다.
//    그 코드는 볼트 전체를 읽고 외부로 보낼 수도 있습니다.
//
// 방식: 예전에는 "코드 부분은 건너뛰고 나머지만 고친다"였는데, 정규식으로 코드 영역을 판단하는 것이
// 실제 마크다운 해석과 조금만 달라도(문장 중간의 ```, \` 등) 그대로 빠져나가는 구멍이 됐습니다.
// 그래서 지금은 코드인지 아닌지 따지지 않고 **어디서나** 위험한 문법 바로 뒤에 보이지 않는 글자를
// 끼워 넣습니다. 마크다운은 그걸 태그/이미지로 인식하지 못하고, 코드 안에서는 눈에 보이지 않습니다.
// 그린 뒤에는 그 글자를 화면의 글자에서 다시 지워서, 복사해도 원래 글자 그대로 나옵니다.

// 문법을 끊는 표시. 그린 뒤 finalizeRenderedAnswer()가 화면 글자에서 전부 지웁니다.
const BREAK = '\u200B'; // 폭 없는 공백(zero-width space)
// 그린 뒤에도 남겨 두는 표시. 다른 플러그인이 나중에 다시 읽어도 실행되지 않게 계속 막아둡니다.
const GUARD = '\u2060'; // 단어 결합자(word joiner) — 역시 눈에 보이지 않습니다.

// 그대로 그려도 외부 요청이 없는 서식 태그들입니다. 속성이 하나도 없을 때만 허용합니다
// (속성이 붙으면 style="..."로 외부 요청을 만들 수 있으므로). 표 안의 <br>을 LLM이 자주 씁니다.
const SAFE_TAG = /<\/?(?:br|b|i|u|em|strong|sub|sup|kbd|mark|s|del|ins|small)\s*\/?>/iy;
// <https://주소> 형태의 자동 링크는 클릭해야 열리는 링크라서 그대로 둡니다.
const AUTOLINK = /<[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*>/y;

// 코드블록 언어 이름 중 다른 플러그인이 가로챌 일이 없는 일반 프로그래밍 언어들입니다.
// 여기 없는 이름(dataviewjs, dataview, query, mermaid 등)은 이름 앞에 표시를 붙여서, 어떤
// 플러그인도 처리하지 않는 "그냥 코드"로 보이게 합니다(내용은 그대로 보입니다).
const PLAIN_CODE_LANGUAGES = new Set([
	'text', 'txt', 'plain', 'plaintext', 'markdown', 'md', 'log', 'diff', 'patch', 'csv',
	'bash', 'sh', 'shell', 'zsh', 'console', 'powershell', 'ps1', 'ps', 'cmd', 'bat', 'batch',
	'python', 'py', 'javascript', 'js', 'mjs', 'cjs', 'typescript', 'ts', 'jsx', 'tsx',
	'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env',
	'xml', 'html', 'htm', 'svg', 'css', 'scss', 'sass', 'less',
	'sql', 'plsql', 'mysql', 'postgresql', 'tsql', 'graphql', 'gql',
	'java', 'kotlin', 'kt', 'scala', 'groovy', 'gradle', 'c', 'h', 'cpp', 'c++', 'cc', 'hpp',
	'cs', 'csharp', 'fsharp', 'vb', 'vbnet', 'vba', 'go', 'golang', 'rust', 'rs', 'swift',
	'objectivec', 'objc', 'dart', 'ruby', 'rb', 'php', 'perl', 'pl', 'lua', 'r', 'matlab',
	'julia', 'haskell', 'hs', 'elixir', 'erlang', 'clojure', 'lisp', 'scheme', 'ocaml',
	'fortran', 'cobol', 'abap', 'asm', 'assembly', 'nasm', 'verilog', 'vhdl', 'solidity',
	'dockerfile', 'docker', 'makefile', 'make', 'cmake', 'nginx', 'apache', 'http',
	'protobuf', 'proto', 'terraform', 'hcl', 'regex', 'latex', 'tex',
]);

// 줄 맨 앞(들여쓰기·인용 >·목록 기호 뒤 포함)의 ``` / ~~~ 와 그 뒤 언어 이름.
// 진짜 코드블록이 아닌 줄에 잘못 걸려도 이름 앞에 보이지 않는 글자가 붙을 뿐이라 안전합니다.
const FENCE_LANGUAGE = /^([ \t>*+\-\d.)]*?)(`{3,}|~{3,})([ \t]*)([^\s`]+)/gm;

function neutralizeFenceLanguage(
	_match: string,
	prefix: string,
	fence: string,
	space: string,
	language: string,
): string {
	const safe = PLAIN_CODE_LANGUAGES.has(language.toLowerCase());
	return `${prefix}${fence}${space}${safe ? '' : GUARD}${language}`;
}

// < 뒤에 글자가 오면 태그로 해석될 수 있습니다(<img, </div, <!--, <?xml 등).
// 허용한 서식 태그와 자동 링크만 빼고, < 바로 뒤에 표시를 끼워 글자 그대로 보이게 합니다.
function breakHtml(markdown: string): string {
	return markdown.replace(/<(?=[a-zA-Z/!?])/g, (_lt, offset: number) => {
		for (const allowed of [SAFE_TAG, AUTOLINK]) {
			allowed.lastIndex = offset;
			if (allowed.test(markdown)) return '<';
		}
		return `<${BREAK}`;
	});
}

export function neutralizeRemoteContent(markdown: string): string {
	return breakHtml(
		markdown
			// ![설명](주소), ![설명][참조] → 이미지가 아니라 "!" + 클릭해야 열리는 링크가 됩니다.
			// ![[노트]]처럼 볼트 안 파일을 끼워 넣는 문법은 외부 요청이 아니므로 그대로 둡니다
			// (단, ![[x]](주소)처럼 뒤에 괄호가 이어지면 이미지로 해석될 수 있어 막습니다).
			.replace(/!\[(?!\[[^[\]\n]*\]\](?![([]))/g, `!${BREAK}[`)
			// Dataview의 인라인 쿼리(`= ...`, `$= ...`)가 실행되지 않게 백틱과 = 사이를 끊습니다.
			// (Dataview 설정에서 다른 시작 기호를 쓰는 경우까지는 막지 못합니다.)
			.replace(/(`+)([ \t]*)(?=\$?=)/g, `$1$2${GUARD}`)
			.replace(FENCE_LANGUAGE, neutralizeFenceLanguage),
	);
}

// 그린 뒤에 호출합니다.
// 1) 이미지였던 링크 앞의 "!"를 🖼 표시로 바꿔서, 원래 이미지 자리였음을 알 수 있게 합니다.
// 2) 문법을 끊으려고 넣었던 보이지 않는 글자를 지워서, 화면에서 복사해도 원문 그대로 나오게 합니다.
//    (글자만 바꾸는 것이라 이미 그려진 결과가 다시 해석되지는 않습니다.)
// 3) 혹시 위의 전처리가 놓친 형태가 있더라도 외부 주소를 가진 미디어 요소는 지웁니다
//    (볼트 안 파일은 app:// 주소라서 남습니다).
// 4) 링크를 클릭해도 아무 데도 연결되지 않는 글자로 바꿉니다. 원칙이 "외부로 연결을 시도하는 일
//    자체가 없어야 한다"이므로, 클릭 한 번으로 브라우저(웹)·파일 공유(file://다른PC)·다른 앱
//    (obsidian://, mailto:)이 열리는 것도 막습니다. 볼트 안 노트 링크·태그·각주(#…)만 그대로 둡니다.
//    주소는 옆에 글자로 보여주고, 누르면 onBlockedLinkClick으로 알려서 복사할 수 있게 합니다.
export function finalizeRenderedAnswer(
	el: HTMLElement,
	options: { onBlockedLinkClick?: (href: string) => void } = {},
): void {
	const walker = el.doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const textNodes: Text[] = [];
	while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

	for (const node of textNodes) {
		if (!node.data.includes(BREAK)) continue;
		// 팝아웃 창에서는 instanceof가 틀린 답을 주므로 태그 이름으로 확인합니다.
		if (node.data.endsWith(`!${BREAK}`) && node.nextSibling?.nodeName === 'A') {
			node.data = `${node.data.slice(0, -2)}🖼 `;
		}
		node.data = node.data.split(BREAK).join('');
	}

	el.querySelectorAll('a').forEach((link) => {
		const href = link.getAttribute('href') ?? '';
		const hasScheme = /^[a-z][a-z0-9+.-]*:|^[\\/]{2}/i.test(href.trim()); // https:, file:, //서버, \\서버
		const isVaultLink =
			link.hasClass('internal-link') || link.hasClass('tag') || href.startsWith('#');
		if (isVaultLink && !hasScheme) return;

		const text = link.textContent ?? '';
		const inert = link.doc.createElement('span');
		inert.addClass('intra-copilot-inert-link');
		inert.setText(text);
		if (href && href !== text) {
			inert.createSpan({ cls: 'intra-copilot-inert-link-url', text: ` (${href})` });
		}
		inert.addEventListener('click', () => options.onBlockedLinkClick?.(href));
		link.replaceWith(inert);
	});

	el.querySelectorAll('img, iframe, video, audio, source, object, embed').forEach((node) => {
		const src = node.getAttribute('src') ?? node.getAttribute('data') ?? '';
		if (/^(https?:)?\/\//i.test(src.trim())) {
			node.remove();
		}
	});
}
