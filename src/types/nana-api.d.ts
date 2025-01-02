declare module "nana-api" {
  export interface nHentaiAPI {
    g(id: number): Promise<{
      id: string;
      media_id: string;
      tags: Array<{ name: string }>;
      title: {
        english: string;
        japanese: string;
        pretty: string;
      };
      images: {
        pages: any[];
        cover: any;
        thumbnail: any;
      };
    }>;
  }

  export default class NanaAPI implements nHentaiAPI {
    constructor();
    g(id: number): Promise<{
      id: string;
      media_id: string;
      tags: Array<{ name: string }>;
      title: {
        english: string;
        japanese: string;
        pretty: string;
      };
      images: {
        pages: any[];
        cover: any;
        thumbnail: any;
      };
    }>;
  }
}
