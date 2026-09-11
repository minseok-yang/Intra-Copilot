import * as dns from 'dns';
import * as net from 'net';

// 이 플러그인이 네트워크로 나가는 모든 요청은 보내기 전에 여기를 통과해야 합니다.
//
// 원칙: 사내에서 구동될 때 외부 PC·웹으로 연결을 "시도"하는 일 자체가 없어야 합니다.
// 그래서 서버 주소를 이름으로 판단하지 않고, **실제로 연결될 IP**가 아래 허용 대역 안에
// 있을 때만 요청을 보냅니다. 이름이 사내 서버처럼 보여도 외부 IP로 풀리면 차단하고,
// 반대로 어떤 이름이든 사내(사설) IP로 풀리면 허용합니다.
// 이 목록은 빌드할 때 main.js에 들어가므로, 사내에서 설정 화면으로는 바꿀 수 없습니다.

// ─── 빌드 전에 고치는 곳 ───────────────────────────────────────────────
// 연결을 허용하는 IP 대역입니다(주소, 앞자리 비트 수). 기본값은 사설망과 이 PC 자신뿐입니다.
// 사내망이 다른 대역(예: 100.64.0.0/10)을 쓴다면 여기에 한 줄 추가하세요.
const ALLOWED_IP_RANGES: ReadonlyArray<readonly [address: string, prefixLength: number]> = [
	['127.0.0.0', 8], // 이 PC 자신(localhost)
	['10.0.0.0', 8], // 사설망
	['172.16.0.0', 12], // 사설망
	['192.168.0.0', 16], // 사설망
	['::1', 128], // 이 PC 자신(IPv6)
	['fc00::', 7], // 사설망(IPv6)
];

// 비워 두면: 이름이 위 대역의 IP로 풀리기만 하면 허용합니다.
// 채우면: 추가로 이 이름으로 끝나는 주소만 허용합니다(예: ['.corp.example.com']).
const ALLOWED_HOST_SUFFIXES: readonly string[] = [];
// ────────────────────────────────────────────────────────────────────

const allowedIps = new net.BlockList();
for (const [address, prefixLength] of ALLOWED_IP_RANGES) {
	allowedIps.addSubnet(address, prefixLength, net.isIPv6(address) ? 'ipv6' : 'ipv4');
}

export class BlockedHostError extends Error {
	constructor(detail: string) {
		super(detail);
		this.name = 'BlockedHostError';
	}
}

export interface ResolvedHost {
	address: string;
	family: 4 | 6;
}

function isAllowedIp(ip: string): boolean {
	// IPv4 주소가 IPv6 모양(::ffff:10.0.0.1)으로 오는 경우도 IPv4로 봅니다.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
	if (mapped) return allowedIps.check(mapped, 'ipv4');
	return allowedIps.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

function matchesAllowedSuffix(host: string): boolean {
	if (ALLOWED_HOST_SUFFIXES.length === 0) return true;
	return ALLOWED_HOST_SUFFIXES.some((suffix) => {
		const bare = suffix.replace(/^\./, '').toLowerCase();
		return host === bare || host.endsWith(`.${bare}`);
	});
}

// 주소를 IP로 풀어 보고, 모든 IP가 허용 대역 안일 때만 그중 하나를 돌려줍니다.
// 하나라도 밖이면 BlockedHostError — 요청은 아예 보내지 않습니다.
// (이름을 찾지 못하면 dns가 ENOTFOUND 오류를 던지고, 화면에는 "서버에 연결할 수 없음"으로 보입니다.)
export async function resolveAllowedHost(hostname: string): Promise<ResolvedHost> {
	const host = hostname.replace(/^\[|\]$/g, '').toLowerCase(); // [fc00::1] → fc00::1
	const isIpLiteral = net.isIP(host) !== 0;
	if (!isIpLiteral && !matchesAllowedSuffix(host)) {
		throw new BlockedHostError(`${host} (not in the allowed domain list)`);
	}

	const addresses: ResolvedHost[] = isIpLiteral
		? [{ address: host, family: net.isIPv6(host) ? 6 : 4 }]
		: (await dns.promises.lookup(host, { all: true })).map(({ address, family }) => ({
				address,
				family: family === 6 ? 6 : 4,
			}));

	const first = addresses[0];
	if (!first || addresses.some(({ address }) => !isAllowedIp(address))) {
		const resolved = addresses.map(({ address }) => address).join(', ');
		throw new BlockedHostError(isIpLiteral ? host : `${host} → ${resolved || '(none)'}`);
	}
	return first;
}
