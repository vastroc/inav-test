import type { Env } from "./env";

/**
 * 评论来源信息：设备 / 浏览器在本地用正则解析（不依赖外部服务，也不会把 UA 发给第三方）；
 * 归属地走百度 opendata 的公开查询接口（免费、无需 Key、返回中文，IPv4 覆盖好）。
 */

const IP_LOOKUP_ENDPOINT = "https://opendata.baidu.com/api.php";
const IP_LOOKUP_TIMEOUT = 4000;

/** 评论来源 IP：Cloudflare 的 CF-Connecting-IP 优先，本地 dev 走这些头兜底 */
export function clientIp(request: Request): string {
  const direct = request.headers.get("cf-connecting-ip") ?? "";
  if (direct) return direct.trim();
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  if (forwarded) return (forwarded.split(",")[0] ?? "").trim();
  return (request.headers.get("x-real-ip") ?? "").trim().slice(0, 64);
}

/** 私网 / 保留地址不外查，避免无意义请求，也避免把内网信息发出去 */
function isPublicIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "::1" || ip === "::" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return false;
  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("0.")) return false;
  if (ip.startsWith("192.168.") || ip.startsWith("169.254.")) return false;
  if (ip.startsWith("100.")) {
    const second = Number(ip.split(".")[1]);
    if (second >= 64 && second <= 127) return false;
  }
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    if (second >= 16 && second <= 31) return false;
  }
  return true;
}

/**
 * 版本号统一成「主.次」一位小数：UA 里没有次版本（多数是 Chrome/Edge 的 xxx.0.0.0）
 * 时补 .0，保证同一列里数字位数一致，例如 Chrome 130.0、iOS 18.1、macOS 10.15。
 */
function oneDecimal(major: string | undefined, minor?: string | null): string {
  const head = (major ?? "").trim();
  if (!head) return "";
  const tail = (minor ?? "").trim() || "0";
  return head + "." + tail;
}

/**
 * 操作系统：类型 + 版本（一位小数），例如 Windows 10/11、macOS 10.15、iOS 18.1、Android 14.0。
 * 顺序重要：iOS 的 UA 里带「like Mac OS X」，HarmonyOS / Android 里带 Linux。
 */
function parseOs(s: string): string {
  const win = s.match(/Windows NT (\d+\.\d+)/i);
  if (win) {
    const map: Record<string, string> = {
      "10.0": "Windows 10/11",
      "6.3": "Windows 8.1",
      "6.2": "Windows 8",
      "6.1": "Windows 7",
      "6.0": "Windows Vista",
      "5.1": "Windows XP",
    };
    return map[win[1]] ?? "Windows";
  }
  if (/Windows Phone/i.test(s)) return "Windows Phone";

  const ios = s.match(/(?:iPhone|iPad|iPod).*?OS (\d+)[._](\d+)/i);
  if (ios) return "iOS " + oneDecimal(ios[1], ios[2]);

  const harmony = s.match(/(?:HarmonyOS|OpenHarmony)[\/ ]?(\d+)(?:[._](\d+))?/i);
  if (harmony) return "HarmonyOS" + (harmony[1] ? " " + oneDecimal(harmony[1], harmony[2]) : "");

  const android = s.match(/Android[\/ ]?(\d+)(?:[._](\d+))?/i);
  if (android) return "Android " + oneDecimal(android[1], android[2]);

  if (/CrOS/i.test(s)) return "ChromeOS";

  const mac = s.match(/Mac OS X[\/ ]?(\d+)[._](\d+)/i);
  if (mac) return "macOS " + oneDecimal(mac[1], mac[2]);

  if (/Ubuntu/i.test(s)) return "Ubuntu";
  if (/Linux|X11/i.test(s)) return "Linux";
  return "";
}

/** iPad / Android 平板 / 手机 / 桌面 / 爬虫，粒度到「够看懂」为止 */
export function parseUserAgent(ua: string): { device: string; browser: string; os: string } {
  const s = (ua || "").trim();
  if (!s) return { device: "未知", browser: "未知", os: "" };
  if (/bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless|python-requests|curl\//i.test(s)) {
    return { device: "爬虫", browser: "脚本", os: "" };
  }

  let device = "桌面";
  if (/iPad|Tablet|PlayBook|Silk|Nexus 7|Nexus 9|Pad\b/i.test(s)) device = "平板";
  else if (/iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|Mobile Safari/i.test(s)) device = "手机";
  else if (/Android/i.test(s)) device = "平板";

  // 每个正则都抓「主版本 + 可选的次版本」，输出统一成一位小数
  const version = (pattern: RegExp): string => {
    const hit = s.match(pattern);
    if (!hit?.[1]) return "";
    return " " + oneDecimal(hit[1], hit[2]);
  };

  // 顺序重要：Edge / Opera / 微信 / QQ 的 UA 里都带 Chrome 或 Safari
  let browser: string;
  if (/MicroMessenger/i.test(s)) browser = "微信" + version(/MicroMessenger\/(\d+)(?:\.(\d+))?/);
  else if (/QQBrowser/i.test(s)) browser = "QQ 浏览器" + version(/QQBrowser\/(\d+)(?:\.(\d+))?/);
  else if (/UCBrowser/i.test(s)) browser = "UC 浏览器" + version(/UCBrowser\/(\d+)(?:\.(\d+))?/);
  else if (/Edg[A-Z]?\//i.test(s)) browser = "Edge" + version(/Edg[A-Z]?\/(\d+)(?:\.(\d+))?/);
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera" + version(/(?:OPR|Opera)\/(\d+)(?:\.(\d+))?/);
  else if (/Firefox\//i.test(s)) browser = "Firefox" + version(/Firefox\/(\d+)(?:\.(\d+))?/);
  else if (/CriOS\//i.test(s)) browser = "Chrome" + version(/CriOS\/(\d+)(?:\.(\d+))?/);
  else if (/Chrome\//i.test(s)) browser = "Chrome" + version(/Chrome\/(\d+)(?:\.(\d+))?/);
  else if (/Safari\//i.test(s)) browser = "Safari" + version(/Version\/(\d+)(?:\.(\d+))?/);
  else browser = "其他";

  return { device, browser, os: parseOs(s) };
}

/** 归属地只保留「省份/国家」这一级，前台按中文互联网习惯展示「IP属地：广东」 */
export function provinceOf(location: string): string {
  const text = (location || "").trim();
  if (!text) return "";
  // 百度返回的是「江苏省南京市 电信」，先去掉运营商那一段
  const head = text.split(/[\s　]+/)[0] ?? "";
  // 注意顺序：特别行政区、自治区要排在「省/市」前面，否则「内蒙古自治区」会被「区」截断
  for (const pattern of [/^(.+?特别行政区)/u, /^(.+?自治区)/u, /^(.+?省)/u, /^(.+?市)/u]) {
    const hit = head.match(pattern);
    if (hit?.[1]) {
      return hit[1].replace(/(省|市|自治区|特别行政区)$/u, "").replace(/(维吾尔|壮族|回族)$/u, "") || hit[1];
    }
  }
  return head;
}

/**
 * 查 IP 归属地。失败/超时/查不到都返回空串——归属地只是展示信息，不能影响评论本身。
 * 百度这个接口对 IPv4 比较准，IPv6 基本查不到，此时保持空串（前台不显示属地）。
 */
export async function lookupIpLocation(ip: string): Promise<string> {
  if (!isPublicIp(ip)) return "";
  const url = `${IP_LOOKUP_ENDPOINT}?query=${encodeURIComponent(ip)}&co=&resource_id=6006&oe=utf8`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "iNav-CommentMeta/1.0 (+https://github.com; comment ip location)",
      },
      signal: AbortSignal.timeout(IP_LOOKUP_TIMEOUT),
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { data?: Array<{ location?: string }> };
    const location = payload.data?.[0]?.location ?? "";
    return location.trim().slice(0, 40);
  } catch {
    return "";
  }
}

/** 提交后异步补写归属地（waitUntil 里调用），写失败也不影响评论发布 */
export async function fillCommentLocation(env: Env, commentId: number, ip: string): Promise<void> {
  if (!ip) return;
  const location = await lookupIpLocation(ip);
  if (!location) return;
  await env.DB.prepare("UPDATE comments SET ip_location = ? WHERE id = ?").bind(location, commentId).run();
}
