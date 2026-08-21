import fitz, os
doc = fitz.open("attached_assets/مثال_1_-_اقرار_اول_1787321706910.pdf")
print("pages:", doc.page_count)
out = ".agents/outputs/disclosure_example"
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    p = os.path.join(out, f"page_{i+1:02d}.png")
    pix.save(p)
    print(p, pix.width, "x", pix.height)
