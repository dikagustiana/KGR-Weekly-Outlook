declare module "pdfmake" {
  const PdfPrinter: new (fonts: Record<string, Record<string, Buffer | string>>) => {
    createPdfKitDocument(def: unknown): NodeJS.ReadableStream & { end(): void };
  };
  export default PdfPrinter;
}
declare module "pdfmake/build/vfs_fonts.js" {
  const vfs: Record<string, string>;
  export default vfs;
}
