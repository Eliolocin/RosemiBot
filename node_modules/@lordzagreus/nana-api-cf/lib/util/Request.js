const axios = require("axios");
const cheerio = require("cheerio");
const Qs = require("qs");

const baseUrl = "https://nhentai.net";
const pipeUrl = (url) => `https://translate.google.com/translate?sl=vi&tl=en&hl=vi&u=${url}&client=webapp`;

/**
 * @class Request
 */
module.exports = class Request {
  constructor() {}

  /**
   * Get book API from book book ID
   *
   * @param {string} bookID nHentai book ID
   * @returns {object|null} nHentai book API
   */
  async getBook(bookID) {
    let json = pipeUrl(`${baseUrl}/api/gallery/${bookID}`);

    return axios
      .get(json)
      .then((res) => res.data)
      .catch((e) => {
        if (e.response.status == 404 || e.response.status == 403)
          return null;
        else throw e;
      });
  }

  /**
   * Get book API from book book ID
   *
   * @param {string} bookID nHentai book ID
   * @return {object|null} nHentai book API
   */
  async getRelated(bookID) {
    let json = pipeUrl(`${baseUrl}/api/gallery/${bookID}/related`);

    return axios
      .get(json)
      .then((res) => res.data)
      .catch((e) => {
        if (e.response.status == 404 || e.response.status == 403)
          return null;
        else throw e;
      });
  }

  /**
   * Get book list from nHentai url
   *
   * @param {string} url nHentai url
   * @returns {object} nHentai search list
   */
  async getList(url) {
    return axios
      .get(pipeUrl(url))
      .then((res) => {
        const $ = cheerio.load(res.data, {
          decodeEntities: false,
        });

        let results = [];
        $(".gallery").each((i, e) => {
          let $this = $(e);
          let id = $this
            .find(".cover")
            .attr("href")
            .match(/(?<=\/g\/).+(?=\/)/);
          let title = $this.find(".caption").html();
          let thumb = $this.find(".cover > img");
          let tags = $this.attr("data-tags").split(" ");

          let lang = tags.includes("6346")
            ? "japanese"
            : tags.includes("12227")
              ? "english"
              : tags.includes("29963")
                ? "chinese"
                : undefined;

          results.push({
            id: id[0],
            title: title,
            language: lang,
            thumbnail: {
              s:
                thumb.attr("data-src") ||
                thumb.attr("src").replace(/^\/\//, "https://"),
              w: thumb.attr("width"),
              h: thumb.attr("height"),
            },
          });
        });

        let paginationUrl = $(
          `.pagination>${
            $(".pagination>.last").length > 0 ? ".last" : ".current"
          }`
        ).attr("href");
        let numResults = $("#content>h1").text().replace(",", "");
        let extra = {};

        // getting total manga results
        if (isNaN(parseInt(numResults)))
          extra.num_results = parseInt($("meta[name='description']").attr("content").replace(",", "").match(/\d+/g));
        else
          extra.num_results = parseInt(numResults);

        // if there is no pagination on page, set num_pages to 1
        if (!paginationUrl) 
          extra.num_pages = 1;
        else
          extra.num_pages = parseInt(
            Qs.parse(paginationUrl.slice(paginationUrl.lastIndexOf("?") + 1))
              .page
          );

        return {
          ...extra,
          results,
        };
      });
  }

  /**
   * Get popular list from nHentai homepage
   *
   * @returns {object} nHentai popular list
   */
  async getPopularNow() {
    return axios.get(pipeUrl(baseUrl)).then((res) => {
      const $ = cheerio.load(res.data, {
        decodeEntities: false,
      });

      let results = [];
      $(".index-popular .gallery").each((i, e) => {
        let $this = $(e);
        let id = $this
          .find(".cover")
          .attr("href")
          .match(/(?<=\/g\/).+(?=\/)/);
        let title = $this.find(".caption").html();
        let thumb = $this.find(".cover > img");
        let tags = $this.attr("data-tags").split(" ");

        let lang = tags.includes("6346")
          ? "japanese"
          : tags.includes("12227")
            ? "english"
            : tags.includes("29963")
              ? "chinese"
              : undefined;

        results.push({
          id: id[0],
          title: title,
          language: lang,
          thumbnail: {
            s:
              thumb.attr("data-src") ||
              thumb.attr("src").replace(/^\/\//, "https://"),
            w: thumb.attr("width"),
            h: thumb.attr("height"),
          },
        });
      });

      return {
        results,
      };
    });
  }
};

