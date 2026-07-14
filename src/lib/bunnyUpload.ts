import { supabase } from "@/lib/supabase";

interface BunnyUploadResult {
  success: boolean;
  videoGuid: string;
  publicUrl: string;
  thumbnailUrl: string;
  title: string;
  fileName: string;
}

interface BunnyStorageResult {
  success: boolean;
  publicUrl: string;
  storagePath: string;
  fileName: string;
}

const getSupabaseUrl = () => import.meta.env.VITE_SUPABASE_URL as string;
const getAnonKey = () => import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const getAuthToken = async () => {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || getAnonKey();
};

const xhrUpload = <T>(
  url: string,
  formData: FormData,
  authToken: string,
  onProgress?: (pct: number) => void
): Promise<T> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress?.(Math.round((e.loaded / e.total) * 80) + 10);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (!data.success) reject(new Error(data.error || "Upload failed"));
          else {
            onProgress?.(95);
            resolve(data as T);
          }
        } catch {
          reject(new Error("Invalid response from upload server"));
        }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          msg = JSON.parse(xhr.responseText).error || msg;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload was aborted")));
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
    xhr.setRequestHeader("apikey", getAnonKey());
    xhr.send(formData);
  });

/** Upload an audio file to Bunny Storage (singles and albums). */
export async function uploadToBunnyStorage(
  file: File,
  folder: "audio" | "albums" = "audio",
  onProgress?: (percent: number) => void
): Promise<BunnyStorageResult> {
  onProgress?.(5);
  const authToken = await getAuthToken();
  onProgress?.(10);

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("folder", folder);

  const result = await xhrUpload<BunnyStorageResult>(
    `${getSupabaseUrl()}/functions/v1/bunny-storage-upload`,
    formData,
    authToken,
    onProgress
  );

  onProgress?.(100);
  return result;
}

/** Upload a video file to Bunny Stream (music videos). */
export async function uploadToBunnyStream(
  file: File,
  title: string,
  onProgress?: (percent: number) => void
): Promise<BunnyUploadResult> {
  onProgress?.(5);
  const authToken = await getAuthToken();
  onProgress?.(10);

  const formData = new FormData();
  formData.append("title", title);
  formData.append("file", file, file.name);

  const result = await xhrUpload<BunnyUploadResult>(
    `${getSupabaseUrl()}/functions/v1/bunny-stream-upload`,
    formData,
    authToken,
    onProgress
  );

  onProgress?.(100);
  return result;
}
