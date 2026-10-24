// iconv-lite の内部で読み込まれる（文字を読む側だけで使う）。印字キットは文字を書く側だけなので最小の代わり
export class StringDecoder {
  constructor() { this.buf = ''; }
  write(b) { return typeof b === 'string' ? b : String.fromCharCode.apply(null, Array.from(b)); }
  end(b) { return b ? this.write(b) : ''; }
}
export default { StringDecoder };
