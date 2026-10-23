/** Save a generated file through a temporary link. Resolves to a short message when something notable happened. */
export async function download(data: Uint8Array, name: string, type: string): Promise<string | null> {
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}
