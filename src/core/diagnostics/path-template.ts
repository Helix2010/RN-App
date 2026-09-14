/**
 * 把一个具体的请求路径变成可以进诊断日志的**路径模板**（设计 §4.2）。
 *
 * - 去掉 query 与 fragment：查询串里有游标、语言，也可能有地址；
 * - 去掉协议与主机：`resource.fileUrl` 是服务端下发的，可能是绝对地址；
 * - 形似 ID 的段落换成 `:id`：地址、交易哈希、对象 ID、带签名的令牌段。
 *
 * 宁可多换掉几段：排查需要的是「哪个接口」，不是「哪个对象」。
 */
const ID_LIKE =
  /^(0x[0-9a-f]{8,}|[0-9a-f]{16,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{24,}|\d{6,})$/i;

export function pathTemplate(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "";
  const pathname = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
  return pathname
    .split("/")
    .map((segment) => (ID_LIKE.test(segment) ? ":id" : segment))
    .join("/");
}
