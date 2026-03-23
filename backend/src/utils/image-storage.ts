/**
 * Image storage utility for saving base64 images to disk.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";

const UPLOADS_DIR = "data/uploads";

interface ImageData {
  data: string; // base64 data URL or raw base64
  mediaType: string; // e.g., "image/png", "image/jpeg"
}

/**
 * Extracts the file extension from a media type.
 */
function getExtension(mediaType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };
  return map[mediaType] || "png";
}

/**
 * Extracts raw base64 from a data URL or returns as-is if already raw.
 */
function extractBase64(data: string): string {
  const match = data.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : data;
}

/**
 * Saves images to disk and returns their relative file paths.
 *
 * @param projectId - Project ID for directory organization
 * @param messageId - Message ID for directory organization
 * @param images - Array of image data objects
 * @returns Array of relative file paths
 */
export function saveImages(
  projectId: string,
  messageId: string,
  images: ImageData[]
): string[] {
  const dir = join(UPLOADS_DIR, projectId, messageId);
  mkdirSync(dir, { recursive: true });

  const paths: string[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const ext = getExtension(img.mediaType);
    const filename = `image-${i}.${ext}`;
    const filePath = join(dir, filename);
    const relativePath = join(projectId, messageId, filename);

    const base64 = extractBase64(img.data);
    const buffer = Buffer.from(base64, "base64");
    writeFileSync(filePath, buffer);

    paths.push(relativePath);
  }

  return paths;
}
