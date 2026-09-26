/**
 * 本文が EPSON Server Direct Print の POST（application/x-www-form-urlencoded の
 * ConnectionType=GetRequest / SetResponse）かどうか。
 * Star CloudPRNT の POST は JSON（printerMAC 等）なので、これで見分けられる。
 */
export function looksLikeServerDirectPrint(bodyText: string, contentType: string | null): boolean {
  if (!bodyText) return false;
  const trimmed = bodyText.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  if (/(^|&)ConnectionType=(GetRequest|SetResponse)/.test(bodyText)) return true;
  return /x-www-form-urlencoded/i.test(contentType ?? '') && /(^|&)(ID|Name|ConnectionType)=/.test(bodyText);
}
