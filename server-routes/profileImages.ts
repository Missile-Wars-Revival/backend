import * as admin from 'firebase-admin';

/**
 * Resolves the Firebase Storage download URL for a user's profile image, server-side.
 *
 * Reconstructs the SAME stable tokenized URL that the client SDK's getDownloadURL()
 * returns, by reading the download token from the object's metadata. A stable URL means
 * expo-image's disk cache stays keyed correctly on the client (unlike signed URLs, which
 * expire and would churn the cache on every push).
 *
 * Returns null when the user has no uploaded image — the client maps that to the default avatar.
 */
export async function resolveProfileImageUrl(username: string): Promise<string | null> {
  try {
    const bucket = admin.storage().bucket();
    const path = `profileImages/${username}`;
    const file = bucket.file(path);
    const [meta] = await file.getMetadata();
    const token = meta?.metadata?.firebaseStorageDownloadTokens;
    if (!token) return null;
    const encoded = encodeURIComponent(path);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encoded}?alt=media&token=${token}`;
  } catch {
    // No image / object not found / storage unavailable -> default avatar on the client.
    return null;
  }
}

/**
 * Batch version: resolves many usernames in parallel and returns a username -> url|null map.
 * Replaces N serialized client-side Firebase round-trips with N co-located metadata reads.
 */
export async function resolveProfileImageUrls(
  usernames: string[],
): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(usernames));
  const entries = await Promise.all(
    unique.map(async (u) => [u, await resolveProfileImageUrl(u)] as const),
  );
  return Object.fromEntries(entries);
}
