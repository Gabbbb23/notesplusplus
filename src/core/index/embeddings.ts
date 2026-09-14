/**
 * Local embeddings for semantic search.
 *
 * The model (bge-small-en-v1.5, int8) runs in-process through
 * @huggingface/transformers. It is downloaded once into `modelCachePath` and
 * loaded lazily on first use. If it cannot load (offline first run, missing
 * runtime), the embedder reports itself unavailable and the index degrades to
 * keyword-only search. Nothing here ever throws past `embed`.
 */

export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMS = 384;

/** Roughly how many characters go in one chunk before embedding. */
export const CHUNK_TARGET_CHARS = 1200;

export interface Embedder {
  readonly model: string;
  readonly dims: number;
  /** Embed each text into a normalized vector of `dims` floats. Returns null when the model is unavailable. */
  embed(texts: string[]): Promise<Float32Array[] | null>;
}

export interface EmbedderOptions {
  modelCachePath: string;
  log?: (msg: string) => void;
}

interface Extractor {
  (texts: string | string[], options?: { pooling?: "mean"; normalize?: boolean }): Promise<{
    dims: number[];
    data: ArrayLike<number>;
  }>;
}

const BATCH_SIZE = 16;

/** The real model. Loads on first `embed`, remembers failure so it is tried once. */
export function createEmbedder(opts: EmbedderOptions): Embedder {
  const log = opts.log ?? (() => {});
  let loading: Promise<Extractor | null> | null = null;

  const load = async (): Promise<Extractor | null> => {
    try {
      const tf = await import("@huggingface/transformers");
      tf.env.cacheDir = opts.modelCachePath;
      tf.env.allowLocalModels = true;
      tf.env.allowRemoteModels = true;
      const started = performance.now();
      const pipe = await tf.pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
      log(`embedding model ${EMBEDDING_MODEL} ready in ${Math.round(performance.now() - started)} ms`);
      return pipe as unknown as Extractor;
    } catch (err) {
      log(
        `embedding model unavailable, semantic search disabled: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  };

  return {
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    async embed(texts) {
      if (texts.length === 0) return [];
      loading ??= load();
      const extractor = await loading;
      if (!extractor) return null;
      try {
        const out: Float32Array[] = [];
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
          const batch = texts.slice(i, i + BATCH_SIZE);
          const tensor = await extractor(batch, { pooling: "mean", normalize: true });
          const dims = tensor.dims[tensor.dims.length - 1] ?? EMBEDDING_DIMS;
          const data = tensor.data;
          for (let r = 0; r < batch.length; r++) {
            const vec = new Float32Array(dims);
            for (let c = 0; c < dims; c++) vec[c] = Number(data[r * dims + c]);
            out.push(vec);
          }
        }
        return out;
      } catch (err) {
        log(`embedding failed: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
  };
}

/** An embedder that always reports unavailable. Used when embeddings are turned off. */
export function disabledEmbedder(): Embedder {
  return {
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    embed: async () => null,
  };
}

/**
 * Split a note body into chunks of about CHUNK_TARGET_CHARS characters.
 * Splits happen only on blank lines; small paragraphs are merged; a paragraph
 * longer than the target is split on single newlines; a single line is never split.
 */
export function chunkBody(body: string, target: number = CHUNK_TARGET_CHARS): string[] {
  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= target) {
      pieces.push(p);
      continue;
    }
    // Too long for one chunk: break it on line boundaries.
    let current = "";
    for (const line of p.split("\n")) {
      if (current.length > 0 && current.length + 1 + line.length > target) {
        pieces.push(current);
        current = line;
      } else {
        current = current.length === 0 ? line : `${current}\n${line}`;
      }
    }
    if (current.length > 0) pieces.push(current);
  }

  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current.length > 0 && current.length + 2 + piece.length > target) {
      chunks.push(current);
      current = piece;
    } else {
      current = current.length === 0 ? piece : `${current}\n\n${piece}`;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** The text actually embedded for a chunk: the note title first, then the chunk. */
export function chunkEmbeddingText(title: string, chunk: string): string {
  return title.trim().length > 0 ? `${title.trim()}\n\n${chunk}` : chunk;
}
