// 제너레이터 [파일에서 텍스트 가져오기]의 .txt·.eml 풀기(src/generator/mail-text.ts) 테스트입니다.
// 바이트만 다루는 부분이라 Obsidian 없이 그대로 돌아갑니다(npm test).
import assert from 'node:assert/strict';
import { decodeText, emlToText } from '../src/generator/mail-text';

let passed = 0;
function test(name: string, run: () => void): void {
	run();
	passed++;
	console.log(`  ✓ ${name}`);
}

const utf8 = (text: string) => new TextEncoder().encode(text);
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
// 메일 원문은 줄 끝이 CRLF입니다.
const eml = (lines: string[]) => utf8(lines.join('\r\n'));

test('.txt: UTF-8(BOM 있음·없음)을 그대로 읽는다', () => {
	assert.equal(decodeText(utf8('회의 메모')), '회의 메모');
	assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('회의')])), '회의');
});

test('.txt: UTF-8이 아니면 CP949(EUC-KR)로 읽는다', () => {
	// "한글" = C7 D1 B1 DB (CP949)
	assert.equal(decodeText(new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb])), '한글');
});

test('.txt: UTF-16 BOM을 따른다', () => {
	assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x5c, 0xd5, 0x00, 0xae])), '한글');
});

test('.eml: 제목·보낸 사람을 풀고, 일반 텍스트 본문을 HTML보다 먼저 쓴다', () => {
	const text = emlToText(
		eml([
			`Subject: =?UTF-8?B?${b64('주간 ')}?=`,
			` =?UTF-8?B?${b64('보고')}?=`,
			'From: =?UTF-8?Q?=ED=99=8D=EA=B8=B8=EB=8F=99?= <hong@example.com>',
			'To: team@example.com',
			'Date: Wed, 17 Sep 2026 09:00:00 +0900',
			'Content-Type: multipart/alternative; boundary="b1"',
			'',
			'--b1',
			'Content-Type: text/plain; charset=UTF-8',
			'Content-Transfer-Encoding: base64',
			'',
			b64('안녕하세요.\r\n보고드립니다.'),
			'--b1',
			'Content-Type: text/html; charset=UTF-8',
			'',
			'<p>HTML 본문</p>',
			'--b1--',
		]),
	);
	assert.match(text, /^제목: 주간 보고\n보낸 사람: 홍길동 <hong@example.com>\n받는 사람: team@example.com\n받은 시각: Wed, 17 Sep/);
	assert.match(text, /안녕하세요\.\r?\n보고드립니다\./);
	assert.doesNotMatch(text, /HTML 본문/);
});

test('.eml: HTML만 있으면 글자만 뽑고, 첨부는 이름만 적는다', () => {
	const text = emlToText(
		eml([
			'Subject: test',
			'Content-Type: multipart/mixed; boundary=outer',
			'',
			'--outer',
			'Content-Type: text/html; charset="euc-kr"',
			'Content-Transfer-Encoding: quoted-printable',
			'',
			'<html><head><style>p{color:red}</style></head><body><p>=C7=D1=B1=DB &amp; A=',
			'B</p><table><tr><td>c1</td><td>c2</td></tr></table></body></html>',
			'--outer',
			'Content-Type: application/pdf; name="=?UTF-8?B?' + b64('보고서.pdf') + '?="',
			'Content-Disposition: attachment; filename*=UTF-8\'\'%EC%9E%90%EB%A3%8C.pdf',
			'Content-Transfer-Encoding: base64',
			'',
			'JVBERi0=',
			'--outer--',
		]),
	);
	assert.match(text, /첨부: 자료\.pdf/);
	assert.match(text, /한글 & AB\nc1\tc2/);
	assert.doesNotMatch(text, /color:red|JVBERi0/);
});

test('.eml: 여러 부분이 아닌 메일과 머리말 없는 조각', () => {
	const single = emlToText(eml(['Subject: 한 부분', '', '본문 한 줄']));
	assert.equal(single, '제목: 한 부분\n\n본문 한 줄');
	const bare = emlToText(eml(['Subject: x', 'Content-Type: multipart/mixed; boundary=z', '', '--z', '', '머리말 없음', '--z--']));
	assert.match(bare, /머리말 없음/);
});

test('.eml: HTML의 흔한 이름 개체를 글자로 바꾼다', () => {
	const text = emlToText(eml(['Subject: x', 'Content-Type: text/html', '', '<p>A&mdash;B&hellip; &copy;2026 &rsquo;&unknown;</p>']));
	assert.match(text, /A—B… ©2026 ’&unknown;/);
});

test('.eml: 이름 없이 본문에 끼운 이미지도 첨부 줄에 형식으로 적는다', () => {
	const text = emlToText(
		eml([
			'Subject: x',
			'Content-Type: multipart/related; boundary=r',
			'',
			'--r',
			'Content-Type: text/html',
			'',
			'<p>본문</p>',
			'--r',
			'Content-Type: image/png',
			'Content-ID: <logo>',
			'Content-Transfer-Encoding: base64',
			'',
			'iVBORw0=',
			'--r--',
		]),
	);
	assert.match(text, /첨부: image\/png/);
	assert.match(text, /본문/);
});

console.log(`\n  ${passed}개 통과`);
