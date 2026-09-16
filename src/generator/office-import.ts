import { execFile } from 'child_process';
import { Platform } from 'obsidian';

// 제너레이터의 "문서 가져오기"입니다. Word·Excel·PowerPoint·Outlook을 PowerShell로 조종해 본문 글자만
// 받아옵니다. 사내 DRM 문서는 파일을 직접 읽으면 암호문이지만, 인증된 앱(Word 등)이 열면 평문이 되므로
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
// unsupported: Windows가 아님 / timeout: 시간 초과 / failed: 그 밖(detail에 원문)
export type ImportErrorKind = 'no-app' | 'cancelled' | 'pdf' | 'unsupported' | 'timeout' | 'failed';

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
		payload.kind === 'no-app' || payload.kind === 'cancelled' || payload.kind === 'pdf' ? payload.kind : 'failed';
	return { ok: false, kind, detail: (payload.error ?? '').slice(0, 500) };
}

function unsupported(): { ok: false; kind: ImportErrorKind; detail: string } {
	return { ok: false, kind: 'unsupported', detail: process.platform };
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
export async function pickAndReadFile(): Promise<ImportResult> {
	if (!Platform.isWin) return unsupported();
	const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '제너레이터로 가져올 문서를 고르세요'
$dialog.Filter = 'Word·Excel·PowerPoint 문서|*.docx;*.doc;*.docm;*.xlsx;*.xls;*.xlsm;*.pptx;*.ppt'
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { @{ok=$false; kind='cancelled'} | ConvertTo-Json -Compress; exit }
$path = $dialog.FileName
$name = [IO.Path]::GetFileName($path)
$ext = [IO.Path]::GetExtension($path).ToLower()
if ($ext -eq '.pdf') { @{ok=$false; kind='pdf'} | ConvertTo-Json -Compress; exit }
$app = $null
$doc = $null
try {
	if ($ext -like '.doc*') {
		$app = New-Object -ComObject Word.Application
		$app.Visible = $false
		$app.DisplayAlerts = 0
		$doc = $app.Documents.Open($path, $false, $true)
		${EXTRACT.word}
	} elseif ($ext -like '.xls*') {
		$app = New-Object -ComObject Excel.Application
		$app.Visible = $false
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
	if ($doc) { try { $doc.Close() } catch {} }
	if ($app) { try { $app.Quit() } catch {} }
}`;

	return finish(await runPowerShell(script, PICK_TIMEOUT_MS));
}

function finish(run: { ok: true; stdout: string } | { ok: false; kind: ImportErrorKind; detail: string }): ImportResult {
	if (!run.ok) return run;
	const payload = parsePayload(run.stdout);
	if (!payload?.ok) {
		return payload ? failureFrom(payload) : { ok: false, kind: 'failed', detail: run.stdout.slice(0, 500) };
	}
	// Word는 문단 끝에 \r만 남기므로 줄바꿈을 정리하고, 빈 줄이 셋 이상 이어지면 둘로 줄입니다.
	const text = (payload.text ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
	return { ok: true, text, name: payload.name ?? '' };
}
