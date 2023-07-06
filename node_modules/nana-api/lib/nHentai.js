const Request = require("./util/Request");
const axios = require("axios");
const qs = require("qs");

const request = new Request();
const baseUrl = "https://nhentai.net";

/**
 * nHentai API
 *
 * @class nHentai
 */
module.exports = class nHentai {
  constructor() {}

  /**
   * Get book API from book ID or book Link
   *
   * @param {string} query nHentai book ID
   * @returns {object|null} nHentai book object
   */
  g(query) {
    if (typeof query == "number") query = query.toString();
    let id = query.includes(baseUrl)
      ? query.slice(`${baseUrl}/g/`.length).replace(/\//g, "")
      : query;

    return request.getBook(id);
  }

  /**
   * Get random book API
   *
   * @return {object} nHentai book object
   */
  random() {
    let random = `${baseUrl}/random`;
    return axios.get(random).then((res) => {
      let url = res.request._redirectable._currentUrl;
      return this.g(url);
    });
  }

  /**
   * Get related book API from book ID or book Link
   *
   * @param {string} query nHentai book ID
   * @return {object} nHentai book object
   */
  related(query) {
    if (typeof query == "number") query = query.toString();
    let id = query.includes(baseUrl)
      ? query.slice(`${baseUrl}/g/`.length).replace(/\//g, "")
      : query;

    return request.getRelated(id);
  }

  /**
   * Get book list from homepage
   *
   * @param {number} [page=1] page number
   * @return {object} nHentai list object
   */
  homepage(page = 1) {
    let query = qs.stringify({
      page,
    });

    return request.getList(`${baseUrl}/?${query}`);
  }

  /**
   * Get book list from popular section
   *
   * @return {object} nHentai popular list object
   */
  popular() {
    return request.getPopularNow();
  }

  /**
   * Get search list from keyword provided
   *
   * @param {string} keyword search keyword
   * @param {number} [page=1] page number
   * @param {string} [popular=false] get from popular page
   * @return {object} nHentai list object
   */
  search(keyword, page = 1, popular = false) {
    let sort = getSort(popular);
    let query = qs.stringify({
      q: keyword,
      page,
    });
    let url = `${baseUrl}/search/?${query}${sort ? `&sort=${sort}` : ""}`;

    return request.getList(url);
  }

  /**
   * Get tags list from keyword provided
   *
   * @param {string} keyword tag keyword
   * @param {number} [page=1] page number
   * @param {boolean} [popular=false] get from popular page
   * @return {object} nHentai list object
   */
  tag(keyword, page = 1, popular = false) {
    let sort = getSort(popular);
    let query = qs.stringify({
      page,
    });
    let url = `${baseUrl}/tag/${modifyKeyword(keyword)}/${sort}?${query}`;

    return request.getList(url);
  }

  /**
   * Get artist list from keyword provided
   *
   * @param {string} keyword artist keyword
   * @param {number} [page=1] page number
   * @param {boolean} [popular=false] get from popular page
   * @return {object} nHentai list object
   */
  artist(keyword, page = 1, popular = false) {
    let sort = getSort(popular);
    let query = qs.stringify({
      page,
    });
    let url = `${baseUrl}/artist/${modifyKeyword(keyword)}/${sort}?${query}`;

    return request.getList(url);
  }

  /**
   * Get character list from keyword provided
   *
   * @param {string} keyword character keyword
   * @param {number} [page=1] page number
   * @param {boolean} [popular=false] get from popular page
   * @return {object} nHentai list object
   */
  character(keyword, page = 1, popular = false) {
    let sort = getSort(popular);
    let query = qs.stringify({
      page,
    });
    let url = `${baseUrl}/character/${modifyKeyword(keyword)}/${sort}?${query}`;

    return request.getList(url);
  }

  /**
   * Get parody list from keyword provided
   *
   * @param {string} keyword parody keyword
   * @param {number} [page=1] page number
   * @param {boolean} [popular=false] get from popular page
   * @return {object} nHentai list object
   */
  parody(keyword, page = 1, popular = false) {
    let sort = getSort(popular);
    let query = qs.stringify({
      page,
    });
    let url = `${baseUrl}/parody/${modifyKeyword(keyword)}${sort}?${query}`;

    return request.getList(url);
  }

  /**
   * Get group list from keyword provided
   *
   * @param {string} keyword group keyword
   * @param {number} [page=1] page number
   * @param {boolean} [popular=false] get from popular page
   * @return {object} nHentai list object
   */
  group(keyword, page = 1, popular = false) {
    let sort = getSort(popular);
    let query = qs.stringify({
      page,
    });
    let url = `${baseUrl}/group/${keyword.replace(/ /g, "-")}/${sort}?${query}`;

    return request.getList(url);
  }
};

/**
 * additional function to get sort of popular url
 *
 * @param {string} sort param from user
 * @return {string} sort result
 */
function getSort(sort) {
  // if popular param is false, send empty string
  if (sort == false) return "";
  // if popular param not false, get the right sort
  return sort == "all" || sort == true ? "popular" : `popular-${sort}`;
}

/**
 * Modify keyword to replace space and
 * convert it to lowercase
 *
 * @param {string} keyword user keyword
 * @return {string} modified keyword
 */
function modifyKeyword(keyword) {
  return keyword.replace(/ /g, "-").toLowerCase();
}
