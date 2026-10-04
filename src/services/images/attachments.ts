import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import { createId } from '@/src/utils/id';

export async function persistImage(sourceUri: string): Promise<string> {
  const manipulated = await manipulateAsync(sourceUri, [{ resize: { width: 1600 } }], {
    compress: 0.72,
    format: SaveFormat.JPEG,
  });
  const directory = new Directory(Paths.document, 'attachments');
  if (!directory.exists) {
    directory.create();
  }
  const destination = new File(directory, `${createId()}.jpg`);
  await new File(manipulated.uri).copy(destination);
  return destination.uri;
}

export function deleteImage(uri: string | null | undefined): void {
  if (!uri) {
    return;
  }
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Ảnh tạm đã không còn.
  }
}
