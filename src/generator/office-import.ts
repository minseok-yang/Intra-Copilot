import { execFile } from 'child_process';
import { Platform } from 'obsidian';
import { decodeText, emlToText } from './mail-text';

// 제너레이터의 "문서 가져오기"입니다. Word·Excel·PowerPoint·Outlook을 PowerShell로 조종해 본문 글자만
// 받아옵니다(.txt·.eml 파일은 앱 없이 PowerShell이 바이트만 읽어 넘기고 mail-text.ts가 풉니다). 사내 DRM 문서는 파일을 직접 읽으면 암호문이지만, 인증된 앱(Word 등)이 열면 평문이 되므로
// 그 앱에게 물어보는 방식입니다(2026-09-16 사내 실측으로 확인. 결정 15).
//
// 지키는 것
// - 원문은 디스크에 저장하지 않습니다. PowerShell이 열었다 닫고 글자만 표준출력으로 돌려줍니다.
// - PDF는 다루지 않습니다. DRM이 이 경로로는 복호화해 주지 않아 암호문만 나왔습니다(실측 후 폐기).
//   PDF는 뷰어에서 복사해 붙여넣는 길만 씁니다.
// - 받아온 글은 곧바로 서버로 보내지 않고 제너레이터 입력칸에 채웁니다. 사용자가 보고 [만들기]를 눌러야
//   전송됩니다("전송 전에 눈에 보인다" 원칙).
// - PowerShell 명령에 사용자가 쓴 글을 끼워 넣지 않습니다. 넘기는 값은 앱 종류(정해진 네 가지)와
//   목록 번호(정수)뿐이고, 파일 경로는 PowerShell이 띄운 파일 선택 창이 직접 얻습니다.

export type OfficeApp = 'word' | 'excel' | 'powerpoint' | 'outlook';

export interface OpenDocument {
	app: OfficeApp;
	index: number; // 그 앱에서 몇 번째로 열려 있는지(1부터)
	name: string; // 문서 이름(Outlook은 메일 제목)
}

// no-app: 그 앱이 아예 안 켜져 있음 / cancelled: 파일 선택 창에서 취소 / pdf: PDF를 골랐음
// too-large: .txt·.eml이 너무 큼 / unsupported: Windows가 아님 / timeout: 시간 초과 / failed: 그 밖(detail에 원문)
export type ImportErrorKind = 'no-app' | 'cancelled' | 'pdf' | 'too-large' | 'unsupported' | 'timeout' | 'failed';

export type ImportResult =
	| { ok: true; text: string; name: string }
	| { ok: false; kind: ImportErrorKind; detail: string };

export type ListResult = { ok: true; items: OpenDocument[] } | { ok: false; kind: ImportErrorKind; detail: string };

// 목록·읽기는 사람을 기다리지 않으므로 짧게, 파일 선택 창은 사람이 고르는 동안 기다려야 하므로 길게 둡니다.
const READ_TIMEOUT_MS = 90_000;
const PICK_TIMEOUT_MS = 300_000;
// 한글이 깨지지 않게 출력 인코딩을 UTF-8로 맞추고, 오류가 나면 다음 줄로 넘어가지 않게 멈춥니다
// (둘 다 사내 테스트에서 실제로 겪은 문제입니다).
const PREFIX = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='Stop';";

// PowerShell을 한 번 불러 표준출력(JSON 한 줄)을 돌려줍니다.
function runPowerShell(script: string, timeoutMs: number): Promise<{ ok: true; stdout: string } | { ok: false; kind: ImportErrorKind; detail: string }> {
	return new Promise((resolve) => {
		execFile(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-Command', `${PREFIX} ${script}`],
			{ timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024, windowsHide: true },
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ ok: true, stdout });
					return;
				}
				// 시간이 다 되어 우리가 끈 경우에는 killed가 켜져 있습니다(확인창이 떠서 멈춘 경우 등).
				const killed = (error as { killed?: boolean }).killed === true;
				resolve({
					ok: false,
					kind: killed ? 'timeout' : 'failed',
					detail: (stderr || error.message || '').trim().slice(0, 500),
				});
			},
		);
	});
}

interface PsPayload {
	ok?: boolean;
	error?: string;
	kind?: string;
	text?: string;
	name?: string;
	bytes?: string; // .txt·.eml 파일 원본(base64)
	format?: string; // bytes의 형식: 'txt' | 'eml'
	items?: OpenDocument[] | OpenDocument;
}

// PowerShell이 준 JSON을 읽습니다. ConvertTo-Json은 값이 하나인 배열을 배열이 아닌 것으로 바꿔 버리므로
// items는 항상 배열로 맞춰 줍니다.
function parsePayload(stdout: string): PsPayload | null {
	const text = stdout.trim();
	if (!text) return null;
	try {
		return JSON.parse(text) as PsPayload;
	} catch {
		return null;
	}
}

function failureFrom(payload: PsPayload): { ok: false; kind: ImportErrorKind; detail: string } {
	const kind: ImportErrorKind =
		payload.kind === 'no-app' || payload.kind === 'cancelled' || payload.kind === 'pdf' || payload.kind === 'too-large'
			? payload.kind
			: 'failed';
	return { ok: false, kind, detail: (payload.error ?? '').slice(0, 500) };
}

function unsupported(): { ok: false; kind: ImportErrorKind; detail: string } {
	return { ok: false, kind: 'unsupported', detail: process.platform };
}

// [파일에서 텍스트 가져오기]가 받는 형식. 파일 선택 창의 형식 목록과 제너레이터 창의 안내 문구가 둘 다 이 목록을
// 쓰므로, 형식을 늘리면 여기와 pickAndReadFile의 분기만 고치면 됩니다.
const FILE_TYPES: [label: string, extensions: string[]][] = [
	['Word 문서', ['docx', 'doc', 'docm']],
	['Excel 통합 문서', ['xlsx', 'xls', 'xlsm']],
	['PowerPoint 프레젠테이션', ['pptx', 'ppt']],
	['Outlook 메일', ['msg']],
	['메일 파일', ['eml']],
	['텍스트 파일', ['txt']],
];

// 안내 문구용: ".docx .doc ... .txt"
export const SUPPORTED_EXTENSIONS = FILE_TYPES.flatMap(([, extensions]) => extensions.map((ext) => `.${ext}`)).join(' ');

// 파일 선택 창의 형식 목록. Windows는 "|" 앞의 이름만 보여 주므로 이름 안에도 확장자를 적어,
// 드롭다운에서 무엇을 고를 수 있는지 바로 보이게 합니다. 첫 줄은 전부, 그 아래는 종류별입니다.
function dialogFilter(): string {
	const pattern = (extensions: string[]) => extensions.map((ext) => `*.${ext}`).join(';');
	const all = FILE_TYPES.flatMap(([, extensions]) => extensions);
	return [['지원하는 모든 파일', all] as const, ...FILE_TYPES]
		.map(([label, extensions]) => `${label} (${pattern(extensions)})|${pattern(extensions)}`)
		.join('|');
}

// 앱이 켜져 있으면 그 앱을, 아니면 $null을 주는 함수. GetActiveObject는 앱이 없으면 예외를 냅니다.
const GET_APP = `function Get-OfficeApp($id){ try { [Runtime.InteropServices.Marshal]::GetActiveObject($id) } catch { $null } }`;

// ─── (B) 이미 열려 있는 문서 목록 ─────────────────────────────────────
// 새로 앱을 띄우지 않고, 지금 열려 있는 것만 알려 줍니다. 여기서는 이름만 읽고 본문은 읽지 않습니다
// (사용자가 목록에서 하나를 고른 뒤에야 그 문서의 본문을 읽습니다).
export async function listOpenDocuments(): Promise<ListResult> {
	if (!Platform.isWin) return unsupported();
	const script = `
${GET_APP}
$items = New-Object System.Collections.ArrayList
$w = Get-OfficeApp 'Word.Application'
if ($w) { for ($i=1; $i -le $w.Documents.Count; $i++) { [void]$items.Add(@{app='word'; index=$i; name=[string]$w.Documents.Item($i).Name}) } }
$x = Get-OfficeApp 'Excel.Application'
if ($x) { for ($i=1; $i -le $x.Workbooks.Count; $i++) { [void]$items.Add(@{app='excel'; index=$i; name=[string]$x.Workbooks.Item($i).Name}) } }
$p = Get-OfficeApp 'PowerPoint.Application'
if ($p) { for ($i=1; $i -le $p.Presentations.Count; $i++) { [void]$items.Add(@{app='powerpoint'; index=$i; name=[string]$p.Presentations.Item($i).Name}) } }
$o = Get-OfficeApp 'Outlook.Application'
if ($o) { try { $sel = $o.ActiveExplorer().Selection; for ($i=1; $i -le $sel.Count; $i++) { [void]$items.Add(@{app='outlook'; index=$i; name=[string]$sel.Item($i).Subject}) } } catch {} }
@{ok=$true; items=$items} | ConvertTo-Json -Compress -Depth 4`;

	const run = await runPowerShell(script, READ_TIMEOUT_MS);
	if (!run.ok) return run;
	const payload = parsePayload(run.stdout);
	if (!payload?.ok) return payload ? failureFrom(payload) : { ok: false, kind: 'failed', detail: run.stdout.slice(0, 500) };
	const raw = payload.items;
	const items = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
		(item): item is OpenDocument => typeof item?.index === 'number' && typeof item?.app === 'string',
	);
	return { ok: true, items };
}

// 앱마다 본문을 글자로 바꾸는 부분입니다. $doc/$item은 위에서 고른 문서입니다.
// ponytail: Excel은 셀마다 COM을 부르는 느린 방식이라 시트당 200행×40열까지만 읽습니다. 더 큰 표가
// 필요하면 UsedRange.Value2로 한 번에 읽는 방식으로 바꾸세요(그 경우 날짜가 숫자로 나오는 것을 처리해야 함).
const EXTRACT: Record<OfficeApp, string> = {
	word: `$text = [string]$doc.Content.Text`,
	excel: `
$sb = New-Object System.Text.StringBuilder
foreach ($ws in $doc.Worksheets) {
	[void]$sb.AppendLine('## ' + $ws.Name)
	$used = $ws.UsedRange
	$rows = [Math]::Min($used.Rows.Count, 200)
	$cols = [Math]::Min($used.Columns.Count, 40)
	for ($r=1; $r -le $rows; $r++) {
		$cells = @()
		for ($c=1; $c -le $cols; $c++) { $cells += [string]$used.Cells.Item($r,$c).Text }
		[void]$sb.AppendLine((($cells -join "\`t")).TrimEnd())
	}
	if ($used.Rows.Count -gt $rows -or $used.Columns.Count -gt $cols) { [void]$sb.AppendLine('(표가 커서 ' + $rows + '행 ' + $cols + '열까지만 가져왔습니다)') }
	[void]$sb.AppendLine('')
}
$text = $sb.ToString()`,
	powerpoint: `
$sb = New-Object System.Text.StringBuilder
foreach ($slide in $doc.Slides) {
	[void]$sb.AppendLine('## 슬라이드 ' + $slide.SlideIndex)
	foreach ($shape in $slide.Shapes) { if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { [void]$sb.AppendLine([string]$shape.TextFrame.TextRange.Text) } }
	try { foreach ($shape in $slide.NotesPage.Shapes) { if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { [void]$sb.AppendLine('(메모) ' + [string]$shape.TextFrame.TextRange.Text) } } } catch {}
	[void]$sb.AppendLine('')
}
$text = $sb.ToString()`,
	outlook: `
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('제목: ' + [string]$doc.Subject)
try { [void]$sb.AppendLine('보낸 사람: ' + [string]$doc.SenderName) } catch {}
try { [void]$sb.AppendLine('받는 사람: ' + [string]$doc.To) } catch {}
try { [void]$sb.AppendLine('받은 시각: ' + [string]$doc.ReceivedTime) } catch {}
try { if ($doc.Attachments.Count -gt 0) { $names = @(); for ($a=1; $a -le $doc.Attachments.Count; $a++) { $names += [string]$doc.Attachments.Item($a).FileName }; [void]$sb.AppendLine('첨부: ' + ($names -join ', ')) } } catch {}
[void]$sb.AppendLine('')
[void]$sb.AppendLine([string]$doc.Body)
$text = $sb.ToString()`,
};

const APP_IDS: Record<OfficeApp, string> = {
	word: 'Word.Application',
	excel: 'Excel.Application',
	powerpoint: 'PowerPoint.Application',
	outlook: 'Outlook.Application',
};

// 목록에서 고른 문서(이미 열려 있는 것)의 본문을 읽습니다. 문서를 닫거나 고치지 않습니다.
export async function readOpenDocument(target: OpenDocument): Promise<ImportResult> {
	if (!Platform.isWin) return unsupported();
	const app = target.app;
	// 앱 이름은 PowerShell 명령에 그대로 들어가므로, 정해진 네 가지인지 먼저 확인합니다.
	if (!Object.prototype.hasOwnProperty.call(APP_IDS, app)) {
		return { ok: false, kind: 'failed', detail: `unknown app: ${String(app)}` };
	}
	const index = Math.trunc(target.index); // 명령에 끼워 넣는 값이므로 정수임을 확실히 합니다.
	if (!Number.isFinite(index) || index < 1) return { ok: false, kind: 'failed', detail: `bad index: ${String(target.index)}` };

	const pick: Record<OfficeApp, string> = {
		word: `$doc = $app.Documents.Item(${index})`,
		excel: `$doc = $app.Workbooks.Item(${index})`,
		powerpoint: `$doc = $app.Presentations.Item(${index})`,
		outlook: `$doc = $app.ActiveExplorer().Selection.Item(${index})`,
	};
	const script = `
${GET_APP}
$app = Get-OfficeApp '${APP_IDS[app]}'
if (-not $app) { @{ok=$false; kind='no-app'} | ConvertTo-Json -Compress; exit }
try {
	${pick[app]}
	$name = if ('${app}' -eq 'outlook') { [string]$doc.Subject } else { [string]$doc.Name }
	${EXTRACT[app]}
	@{ok=$true; name=$name; text=$text} | ConvertTo-Json -Compress
} catch {
	@{ok=$false; error=$_.Exception.Message} | ConvertTo-Json -Compress
}`;

	return finish(await runPowerShell(script, READ_TIMEOUT_MS));
}

// ─── (C) 닫혀 있는 파일 고르기 ───────────────────────────────────────
// 파일 선택 창도 PowerShell이 띄웁니다. 그래야 경로가 PowerShell 안에서만 오가고, Obsidian이
// Electron 파일 입력에서 실제 경로를 주는지에 기대지 않습니다. 고른 파일은 화면에 보이지 않게 열었다
// 바로 닫으며(원문 미저장), PDF는 목록에서 빼 두고 골랐을 때도 안내만 합니다.
//
// 사용자가 쓰고 있는 Office를 건드리지 않기 위한 세 가지(PowerPoint는 프로그램을 새로 띄울 수 없어서
// New-Object가 늘 켜져 있는 그 프로그램에 붙습니다. Word·Excel도 구성에 따라 그렇습니다):
// - 창 숨기기($app.Visible = $false)는 우리가 새로 띄운 경우에만 합니다. 이미 켜져 있던 프로그램을
//   숨기면 사용자가 보던 창이 사라져 버립니다.
// - 문서는 저장하지 않고 닫습니다($doc.Close(0)). 읽기 전용으로 열지만, 붙은 프로그램 쪽에서
//   저장 여부를 묻는 창이 떠 멈추는 일이 없게 확실히 못 박습니다.
// - 프로그램 끄기($app.Quit())는 남은 문서가 하나도 없을 때만 합니다. 그냥 끄면 사용자가 열어 둔
//   다른 문서까지 함께 닫힙니다.
// .msg는 Outlook이 파일을 열게 해(OpenSharedItem) Outlook 메일과 같은 방식으로 읽습니다. Outlook에는 문서 수로
// 판단하는 규칙이 맞지 않으므로(늘 0개) 메일은 버리고 닫고($doc.Close(1), 0은 저장), 우리가 띄운 경우에만 끕니다.
// .txt·.eml은 앱 없이 바이트만 읽어 넘깁니다(base64라 출력 한도 32MB 안에 들도록 10MB까지만).
// 파일 선택 창은 Windows 기본 창(OpenFileDialog)입니다. PowerShell은 화면 배율(DPI)을 모르는 프로그램이라
// 배율이 100%가 아닌 화면에서는 Windows가 창을 늘려 그려 흐릿해지므로, 창을 띄우기 전에 배율을 안다고
// 알립니다(SetProcessDPIAware). 이 알림이 막힌 환경이어도 창은 그대로 뜨도록 실패는 무시합니다.
export async function pickAndReadFile(): Promise<ImportResult> {
	if (!Platform.isWin) return unsupported();
	const script = `
${GET_APP}
Add-Type -AssemblyName System.Windows.Forms
try { Add-Type -Namespace IntraCopilot -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'; [void][IntraCopilot.Dpi]::SetProcessDPIAware() } catch {}
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '제너레이터로 가져올 파일을 고르세요'
$dialog.Filter = '${dialogFilter()}'
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { @{ok=$false; kind='cancelled'} | ConvertTo-Json -Compress; exit }
$path = $dialog.FileName
$name = [IO.Path]::GetFileName($path)
$ext = [IO.Path]::GetExtension($path).ToLower()
if ($ext -eq '.pdf') { @{ok=$false; kind='pdf'} | ConvertTo-Json -Compress; exit }
if ($ext -eq '.txt' -or $ext -eq '.eml') {
	try {
		if ((Get-Item -LiteralPath $path).Length -gt 10MB) { @{ok=$false; kind='too-large'} | ConvertTo-Json -Compress; exit }
		@{ok=$true; name=$name; format=$ext.Substring(1); bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($path))} | ConvertTo-Json -Compress
	} catch {
		@{ok=$false; error=$_.Exception.Message} | ConvertTo-Json -Compress
	}
	exit
}
$app = $null
$doc = $null
$isMail = $ext -eq '.msg'
$started = $false
try {
	if ($isMail) {
		$started = -not (Get-OfficeApp 'Outlook.Application')
		$app = New-Object -ComObject Outlook.Application
		$doc = $app.Session.OpenSharedItem($path)
		${EXTRACT.outlook}
	} elseif ($ext -like '.doc*') {
		$started = -not (Get-OfficeApp 'Word.Application')
		$app = New-Object -ComObject Word.Application
		if ($started) { $app.Visible = $false }
		$app.DisplayAlerts = 0
		$doc = $app.Documents.Open($path, $false, $true)
		${EXTRACT.word}
	} elseif ($ext -like '.xls*') {
		$started = -not (Get-OfficeApp 'Excel.Application')
		$app = New-Object -ComObject Excel.Application
		if ($started) { $app.Visible = $false }
		$app.DisplayAlerts = $false
		$doc = $app.Workbooks.Open($path, 0, $true)
		${EXTRACT.excel}
	} elseif ($ext -like '.ppt*') {
		$app = New-Object -ComObject PowerPoint.Application
		try { $doc = $app.Presentations.Open($path, $true, $false, $false) }
		catch { $app.Visible = $true; $doc = $app.Presentations.Open($path, $true, $false, $true) }
		${EXTRACT.powerpoint}
	} else {
		@{ok=$false; error=('지원하지 않는 형식: ' + $ext)} | ConvertTo-Json -Compress
		exit
	}
	@{ok=$true; name=$name; text=$text} | ConvertTo-Json -Compress
} catch {
	@{ok=$false; error=$_.Exception.Message} | ConvertTo-Json -Compress
} finally {
	if ($isMail) {
		if ($doc) { try { $doc.Close(1) } catch {} }
		if ($app -and $started) { try { $app.Quit() } catch {} }
	} else {
		if ($doc) { try { $doc.Close(0) } catch { try { $doc.Close() } catch {} } }
		if ($app) {
			$left = 0
			try { $left += $app.Documents.Count } catch {}
			try { $left += $app.Workbooks.Count } catch {}
			try { $left += $app.Presentations.Count } catch {}
			if ($left -eq 0) { try { $app.Quit() } catch {} }
		}
	}
}`;

	return finish(await runPowerShell(script, PICK_TIMEOUT_MS));
}

function finish(run: { ok: true; stdout: string } | { ok: false; kind: ImportErrorKind; detail: string }): ImportResult {
	if (!run.ok) return run;
	const payload = parsePayload(run.stdout);
	if (!payload?.ok) {
		return payload ? failureFrom(payload) : { ok: false, kind: 'failed', detail: run.stdout.slice(0, 500) };
	}
	let raw = payload.text ?? '';
	if (payload.bytes !== undefined) {
		const bytes = Buffer.from(payload.bytes, 'base64');
		raw = payload.format === 'eml' ? emlToText(bytes) : decodeText(bytes);
	}
	// Word는 문단 끝에 \r만 남기므로 줄바꿈을 정리하고, 빈 줄이 셋 이상 이어지면 둘로 줄입니다.
	const text = raw.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
	return { ok: true, text, name: payload.name ?? '' };
}
