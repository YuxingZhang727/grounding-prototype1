import { Capacitor, registerPlugin } from '@capacitor/core';

type PhotoExporterPlugin = {
  saveImage(options: { dataUrl: string; fileName: string }): Promise<{ uri?: string }>;
};

export type ImageExportResult = 'photos' | 'downloaded' | 'shared';

const nativePhotoExporter = registerPlugin<PhotoExporterPlugin>('PhotoExporter');

function safeFileName(fileName: string) {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return /\.(?:jpe?g|png)$/i.test(cleaned) ? cleaned : `${cleaned || 'grounding-journal'}.jpg`;
}

function dataUrlToFile(dataUrl: string, fileName: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/);
  if (!match) throw new Error('The journal image is not in a supported format.');
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return new File([bytes], fileName, { type: match[1] === 'image/jpg' ? 'image/jpeg' : match[1] });
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Saves to Photos on native builds and downloads (or shares) on the web. */
export async function exportImage(dataUrl: string, requestedName: string): Promise<ImageExportResult> {
  const fileName = safeFileName(requestedName);

  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PhotoExporter')) {
    await nativePhotoExporter.saveImage({ dataUrl, fileName });
    return 'photos';
  }

  const file = dataUrlToFile(dataUrl, fileName);
  if (Capacitor.isNativePlatform() && navigator.share && navigator.canShare?.({ files:[file] })) {
    await navigator.share({ files:[file], title:'Grounding journal' });
    return 'shared';
  }

  downloadFile(file);
  return 'downloaded';
}

export function journalFileName(created = Date.now()) {
  const date = new Date(created);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0')
  ].join('-');
  return `grounding-journal-${stamp}.jpg`;
}
