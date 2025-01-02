declare module "booru" {
  export interface BooruCredentials {
    login?: string;
    api_key?: string;
  }

  export interface SearchOptions {
    limit?: number;
    random?: boolean;
    page?: number;
  }

  export interface Post {
    fileUrl: string;
    postView: string;
    id: string;
    tags: string[];
    score: number;
    source?: string;
    rating: string;
    createdAt: Date;
  }

  export interface SearchResults extends Array<Post> {}

  export interface Booru {
    search(tags: string[], options?: SearchOptions): Promise<SearchResults>;
  }

  function createBooru(site: string, credentials?: BooruCredentials): Booru;

  export default createBooru;
}
