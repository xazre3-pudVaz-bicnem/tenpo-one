/** SDK completion includes printer acknowledgement; it is not a paper-start sensor. */
export function printTimingLabel(start: number, prepared: number, completed: number) {
  const seconds = (milliseconds: number) => (Math.max(0, milliseconds) / 1000).toFixed(2);
  return `準備 ${seconds(prepared - start)}秒 / Bluetooth送信・応答 ${seconds(completed - prepared)}秒 / 合計 ${seconds(completed - start)}秒`;
}
