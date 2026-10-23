# Classic horizontal 領収書 (2026-10-23)

Approved layout: centered 領収書; original settlement date/time and order number; recipient + 様; prominent net amount; purpose; tax breakdown and payment; issuer name/address/telephone/registration; revenue stamp space and blank clearance for optional shop seal. No printed 印 box or TENPO ONE footer. Applies to all stores using their own receipt data.

The shared logical layout drives the browser SVG and server raster. The server embeds licensed Noto CJK Japanese font for consistent cloud rendering. Customer and shop text is escaped before Pango rendering. Long recipient/address text wraps, with a taller canvas, rather than being removed. Split issuance keeps the existing amount/tax allocation and one-time issuance checks; no DB schema or sales data changes.

Only 領収書 is changed by this PR. Paid receipts, prepayment order slips, checkout flow and kitchen tickets retain their current production behavior; the earlier receipt-style PR is separate.

Thermal paper has fixed width: the horizontal document is rotated 90 degrees across the roll (384 dots at 58mm / 576 at 80mm), then cut. Turn the paper to read it. StarPRNT uses ESC GS S monochrome raster; Star Markup uses a PNG data URL; ePOS XML uses a 1-bit image; the Bluetooth ESC/POS bridge now supports that image. Nothing is uploaded to an external image service. No new iPad binary is required.

Revenue stamp space is a blank physical placeholder, not a determination of tax due. No new stamp-tax calculation or exemption logic is introduced. Its actual physical size/readability and printer firmware behavior need a real print check; automated checks do not prove a physical print. This change does not promise a print speed target.

Verification: typecheck, ESLint, full Vitest suite; tests cover original timestamps, net-paid amounts, long Japanese text, per-split amount/tax, both paper widths, Star/ESC-POS raster bytes, and rejection of corrupt raster data.

Protocol references:
- https://www.starmicronics.com/support/Mannualfolder/StarPRNT_cm_en.pdf (ESC GS S)
- https://star-m.jp/products/s_print/sdk/StarDocumentMarkup/manual/en/tag-reference/image/index.html
- https://files.support.epson.com/pdf/pos/bulk/epos-print_xml_um_en_revi.pdf
- Font: https://github.com/notofonts/noto-cjk (SIL Open Font License in public/fonts)
