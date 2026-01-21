import { PdfReader } from "pdfreader";

type ExtractResult = {
  text: string;
  pageCount: number;
};

type PdfItem =
  | { page?: number }
  | { text?: string }
  | { x?: number; y?: number; text?: string };

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<ExtractResult> {
  const pages = new Map<number, Array<{ y: number; x: number; text: string }>>();

  const reader = new PdfReader();

  await new Promise<void>((resolve, reject) => {
    reader.parseBuffer(buffer, (err: unknown, item: PdfItem | null) => {
      if (err) {
        reject(err);
        return;
      }

      if (!item) {
        resolve();
        return;
      }

      const page = (item as { page?: number }).page;
      if (typeof page === "number") {
        if (!pages.has(page)) pages.set(page, []);
        return;
      }

      const it = item as { x?: number; y?: number; text?: string };
      if (typeof it.text === "string" && typeof it.x === "number" && typeof it.y === "number") {
        const currentPage = Math.max(1, pages.size); // pdfreader sets page markers in order
        const arr = pages.get(currentPage) ?? [];
        arr.push({ x: it.x, y: it.y, text: it.text });
        pages.set(currentPage, arr);
      }
    });
  });

  const pageNums = Array.from(pages.keys()).sort((a, b) => a - b);
  const parts: string[] = [];

  for (const p of pageNums) {
    const items = pages.get(p) ?? [];
    items.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

    let lastY: number | null = null;
    let line: string[] = [];

    for (const it of items) {
      if (lastY !== null && Math.abs(it.y - lastY) > 0.25) {
        parts.push(line.join(" ").trim());
        line = [];
      }
      line.push(it.text);
      lastY = it.y;
    }

    if (line.length) parts.push(line.join(" ").trim());
    parts.push(""); // page break
  }

  const text = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const pageCount = pageNums.length;

  return { text, pageCount };
}
