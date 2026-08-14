export type ObjectPut = {
  key: string;
  body: Buffer | Uint8Array | NodeJS.ReadableStream;
  contentType?: string;
};

export interface ObjectStorage {
  put(input: ObjectPut): Promise<void>;
  get(key: string): Promise<NodeJS.ReadableStream>;
  head(key: string): Promise<{ size: number; etag?: string }>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, expiresSeconds?: number): Promise<string>;
}
