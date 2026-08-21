import fitz
doc = fitz.open("attached_assets/WEF_New_Economy_Skills_2025_1787313449971.pdf")
print("pages:", doc.page_count, "size:", doc[0].rect)
n = min(14, doc.page_count)
for i in range(n):
    pix = doc[i].get_pixmap(matrix=fitz.Matrix(1.6, 1.6))
    pix.save(f".agents/outputs/wef_p{i+1:02d}.png")
print("rendered", n)
