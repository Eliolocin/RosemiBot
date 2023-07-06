declare module "nana-api" {
  interface nHentaiAPI {
    id: string;
    media_id: string;
    title: nHentaiTitle;
    images: nHentaiImages;
    scanlator: string;
    upload_date: number;
    tags: Array<nHentaiTags>;
    num_pages: number;
    num_favorites: number;
  }

  interface nHentaiListObject {
    num_results: number;
    num_pages: number;
    results: Array<nHentaiListRes>;
  }

  interface nHentaiRelatedAPI {
    result: Array<nHentaiAPI>;
  }

  interface nHentaiTitle {
    english: string;
    japanese: string;
    pretty: string;
  }

  interface nHentaiImages {
    pages: Array<nHentaiImageAttr>;
    cover: nHentaiImageAttr;
    thumbnail: nHentaiImageAttr;
  }

  interface nHentaiImageAttr {
    t: string;
    w: number;
    h: number;
  }

  interface nHentaiTags {
    id: number;
    type: string;
    name: string;
    url: string;
    count: number;
  }

  interface nHentaiListRes {
    id: string;
    title: string;
    language: string;
    thumbnail: nHentaiResThumb;
  }

  interface nHentaiResThumb {
    s: string;
    w: string;
    h: string;
  }

  export default class NanaApi {
    /**
     * Get book API from book ID or book Link
     *
     * @param {string} query nHentai book ID
     * @returns {object|null} nHentai book object
     */
    g(query: string | number): Promise<nHentaiAPI|null>;

    /**
     * Get random book API
     *
     * @returns {object} nHentai book object
     */
    random(): Promise<nHentaiAPI>;

    /**
     * Get related book API from book ID or book Link
     *
     * @param {string | number} query nHentai book ID
     * @returns {object|null} nHentai book object
     */
    related(query: string | number): Promise<nHentaiRelatedAPI|null>;

    /**
     * Get book list from homepage
     *
     * @param {number} [page=1] page number
     * @returns {object} nHentai list object
     */
    homepage(page?: number): Promise<nHentaiListObject>;

    /**
     * Get book list from popular section
     *
     * @returns {object} nHentai popular list object
     */
    popular(): Promise<nHentaiListObject>;

    /**
     * Get search list from keyword provided
     *
     * @param {string} keyword search keyword
     * @param {number} [page=1] page number
     * @param {string} [popular=false] get from popular page
     * @returns {object} nHentai list object
     */
    search(
      keyword: string,
      page?: number,
      popular?: boolean | string
    ): Promise<nHentaiListObject>;

    /**
     * Get tags list from keyword provided
     *
     * @param {string} keyword tag keyword
     * @param {number} [page=1] page number
     * @param {boolean} [popular=false] get from popular page
     * @returns {object} nHentai list object
     */
    tag(
      keyword: string,
      page?: number,
      popular?: boolean | string
    ): Promise<nHentaiListObject>;

    /**
     * Get artist list from keyword provided
     *
     * @param {string} keyword artist keyword
     * @param {number} [page=1] page number
     * @param {boolean} [popular=false] get from popular page
     * @returns {object} nHentai list object
     */
    artist(
      keyword: string,
      page?: number,
      popular?: boolean | string
    ): Promise<nHentaiListObject>;

    /**
     * Get character list from keyword provided
     *
     * @param {string} keyword character keyword
     * @param {number} [page=1] page number
     * @param {boolean} [popular=false] get from popular page
     * @returns {object} nHentai list object
     */
    character(
      keyword: string,
      page?: number,
      popular?: boolean | string
    ): Promise<nHentaiListObject>;

    /**
     * Get parody list from keyword provided
     *
     * @param {string} keyword parody keyword
     * @param {number} [page=1] page number
     * @param {boolean} [popular=false] get from popular page
     * @returns {object} nHentai list object
     */
    parody(
      keyword: string,
      page?: number,
      popular?: boolean | string
    ): Promise<nHentaiListObject>;

    /**
     * Get group list from keyword provided
     *
     * @param {string} keyword group keyword
     * @param {number} [page=1] page number
     * @param {boolean} [popular=false] get from popular page
     * @returns {object} nHentai list object
     */
    group(
      keyword: string,
      page?: number,
      popular?: boolean | string
    ): Promise<nHentaiListObject>;
  }
}
