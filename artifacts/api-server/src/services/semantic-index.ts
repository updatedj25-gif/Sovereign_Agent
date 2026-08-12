export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  embedding?: number[];
}

export interface SemanticSearchResult {
  chunk: CodeChunk;
  score: number;
}

export class SemanticCodeIndexService {
  private static inMemoryIndex: CodeChunk[] = [];

  /**
   * Split codebase files into logical chunks by AST symbols or block windows.
   */
  public static chunkFile(filePath: string, content: string): CodeChunk[] {
    const lines = content.split("\n");
    const chunks: CodeChunk[] = [];
    const chunkSize = 40; // 40 lines per chunk window
    const overlap = 10;

    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const windowLines = lines.slice(i, i + chunkSize);
      if (windowLines.length === 0) continue;

      chunks.push({
        id: `${filePath}:${i + 1}`,
        filePath,
        startLine: i + 1,
        endLine: Math.min(i + chunkSize, lines.length),
        content: windowLines.join("\n"),
      });
    }

    return chunks;
  }

  /**
   * Generate vector embeddings for text snippet via Cloudflare REST AI API.
   */
  public static async generateEmbedding(text: string): Promise<number[]> {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiKey = process.env.CLOUDFLARE_API_KEY;

    if (!accountId || !apiKey) {
      // Fallback simple mock vector if secrets are missing
      return new Array(384).fill(0.1);
    }

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/baai/bge-large-en-v1.5`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: [text] }),
      }
    );

    const json = await response.json();
    return json.result?.data?.[0] || new Array(384).fill(0.1);
  }

  /**
   * Index codebase chunks into memory / vector store.
   */
  public static async indexCodebase(files: { filePath: string; content: string }[]) {
    this.inMemoryIndex = [];

    for (const file of files) {
      const chunks = this.chunkFile(file.filePath, file.content);
      for (const chunk of chunks) {
        chunk.embedding = await this.generateEmbedding(chunk.content);
        this.inMemoryIndex.push(chunk);
      }
    }
  }

  /**
   * Perform Cosine Similarity Semantic Search over indexed code chunks.
   */
  public static async searchSemantic(
    query: string,
    topK: number = 5
  ): Promise<SemanticSearchResult[]> {
    const queryVector = await this.generateEmbedding(query);

    const scored = this.inMemoryIndex.map((chunk) => {
      const score = chunk.embedding
        ? cosineSimilarity(queryVector, chunk.embedding)
        : 0;
      return { chunk, score };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}