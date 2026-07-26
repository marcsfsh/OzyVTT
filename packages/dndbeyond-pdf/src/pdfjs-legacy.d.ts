// Minimal ambient types for the Node-friendly pdfjs build (the package ships no types for this path).
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export interface TextFieldWidget {
    subtype: string;
    fieldName?: string;
    fieldValue?: string | string[] | null;
    contents?: string | null;
    rect?: [number, number, number, number];
  }
  export interface PDFPageProxy {
    getViewport(opts: { scale: number }): { width: number; height: number };
    getAnnotations(): Promise<TextFieldWidget[]>;
  }
  export interface PDFDocumentProxy {
    numPages: number;
    getPage(n: number): Promise<PDFPageProxy>;
    destroy(): Promise<void>;
  }
  export function getDocument(opts: Record<string, unknown>): { promise: Promise<PDFDocumentProxy> };
}
