# Final customer bill and paid receipt — 2026-10-23

Approved by Ronnie, applies to every store using its existing data.

- Product name → count → amount, no vertical borders. Native one-line names use `...` when needed; browser uses visual ellipsis and retains the full name in the title. Amount and quantity remain complete; DB product names are unchanged.
- Modifiers are omitted from the customer document only, retaining the charged line total and existing grouping. Kitchen tickets are unchanged.
- Compact layout and thin rules; store name 18px, products 12px, total label and value 20px, table value 20px in browser. Metadata gap 1.5mm. Native printers use their existing character font and vertical scaling for store/table/total, rather than a large raster image.
- Receipt metadata now includes the already stored guest_count, no schema change. Order number, timestamp and clerk remain present.
- No internal register/printer name, custom promotional header/footer, lookup QR/reference, or TENPO ONE branding on the customer document.
- Prepayment bill: store first, then （お会計伝票・会計前のご確認用）; no extra disclaimer, payments or thank-you footer. Narrow 58mm paper uses a balanced two-line heading.
- Paid receipt: 会計レシート, store contact/registration details, existing tax/service/discount/payment/tendered/change/refund/point information. Footer: ご来店ありがとうございました / またのご来店をお待ちしております. Narrow paper may wrap the footer further to preserve text.
- All three print representations are updated: StarPRNT (including Bluetooth), Star Markup, ePOS XML (including Bluetooth ESC/POS conversion). No native app binary or migration is required.
- Classic horizontal 領収書 from PR #361 is unchanged.

Verification covers 58/80mm, Star Japanese width allowance and EPSON yen width, one row per product, retained charged modifier totals, no modification of source names, hidden printer names, preserved settlement/refund values and guest metadata, and correct footer differences. Automated byte/layout tests do not prove physical font size or cutter behavior; confirm with the next genuine receipt.

## Final separator refinement
Approved after the side-by-side preview: no dotted header/metadata dividers; thin solid lines above/below the item headings and the total; dotted line before the subtotal and after the payment/points section. Tax breakdown is before the total, matching the approved preview. Native solid separators use continuous underscore rows, dotted separators use spaced hyphens, retaining the character-print path. No amounts, tax calculations, payment values or kitchen/invoice layouts are changed.
