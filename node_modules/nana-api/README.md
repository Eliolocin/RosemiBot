# Nana API

nHentai unofficial API

## Install

```
npm install nana-api
```

## Example

```js
const NanaAPI = require("nana-api");
const nana = new NanaAPI();

// Get gallery from book ID or book link
nana.g("14045").then((g) => {
  console.log(g);
});
nana.g("https://nhentai.net/g/4501").then((g) => {
  console.log(g);
});
```

## Results

- **Book Object**

```
{
  id: 4501,
  media_id: '14634',
  title: {
    english: '[Petite*Cerisier (Sakura*Sakura)] Suzumiya Haruhi no meirei (The Melancholy of Haruhi Suzumiya)',
    japanese: '[Petite*Cerisier (さくら＊さくら)] 涼宮ハルヒの命令 (涼宮ハルヒの憂鬱)',
    pretty: 'Suzumiya Haruhi no meirei'
  },
  images: {
    pages: [
	  { t: 'j', w: 1050, h: 1500 },
	  { t: 'j', w: 1050, h: 1500 },
	  { t: 'j', w: 1050, h: 1500 },
	  { t: 'j', w: 1050, h: 1500 },
	  { t: 'j', w: 1050, h: 1500 },
	  ...
	],
    cover: { t: 'j', w: 350, h: 500 },
    thumbnail: { t: 'j', w: 250, h: 357 }
  },
  scanlator: '',
  upload_date: 1403972325,
  tags: [
    {
      id: 190,
      type: 'tag',
      name: 'maid',
      url: '/tag/maid/',
      count: 10631
    },
    {
      id: 2937,
      type: 'tag',
      name: 'big breasts',
      url: '/tag/big-breasts/',
      count: 104551
    },
    {
      id: 8010,
      type: 'tag',
      name: 'group',
      url: '/tag/group/',
      count: 72839
    },
	...
  ],
  num_pages: 10,
  num_favorites: 7
}
```

- **List Object**

```
{
  num_pages: 852,
  results: [
    {
      id: '239990',
      title: "[Fue] Inma no Mikata! | Succubi's Supporter! [English] [biribiri, Hennojin] [Decensored]",
      language: 'english',
      thumbnail: [
		  s: 'https://t.nhentai.net/galleries/1258772/thumb.jpg',
		  w: '250',
		  h: '307'
	  ]
    },
    {
      id: '142825',
      title: '[Higuma-ya (Nora Higuma)] Toaru Mura no Fudeoroshi Jijou | A Certain Village Custom [English] [PSYN + Facedesk] [Digital]',
      language: 'english',
      thumbnail: [
		  s: 'https://t.nhentai.net/galleries/849121/thumb.jpg
		  w: '250',
		  h: '354'
	  ]
    },
    {
      id: '123554',
      title: '[Mizuryu Kei] Teisou Kannen ZERO [English] {doujin-moe.us}',
      language: 'english',
      thumbnail: [
		  s: 'https://t.nhentai.net/galleries/770772/thumb.jpg
		  w: '250',
		  h: '105'
	  ]
	},
	...
  ]
}
```

## API List

The ID of a doujin can be found can be found at after the `/g/` in the search bar or a URL.

`https://nhentai.net/g/248121` in this case `248121` is the ID.

**nanaAPI.g(ID | Link)**

- `ID | Link` can both `string` or `number`

Get book API from book ID of book Link  
return a `Book Object`

**nanaAPI.random()**  
Get random book API  
return a `Book Object`

**nanaAPI.related(ID | Link)**

- `ID | Link` can both `string` or `number`

Get realated book API from book ID or book link  
return a `List Object`

**nanaAPI.homepage([page])**

- `page` is `optional` and must be a `number`

Get book list from nHentai homepage  
return a `List Object`

**nanaAPI.popular()**  
Get book list from popular section  
return a `List Object`

**nanaAPI.search(keyword [, page, popular ])**

- `page` must be a `number`
- `popular` can be a `boolean` or `string`, if set `true` will get the `popular` list
available `string` parameter is: `today`, `all`, and `week`

Get search list from keyword provided
return a `List Object`

**nanaAPI.tag(keyword [, page, popular ])**  
Same as `nanaAPI.search()`

**nanaAPI.artist(keyword [, page, popular ])**  
Same as `nanaAPI.search()`

**nanaAPI.character(keyword [, page, popular ])**  
Same as `nanaAPI.search()`

**nanaAPI.parody(keyword [, page, popular ])**  
Same as `nanaAPI.search()`

**nanaAPI.group(keyword [, page, popular ])**  
Same as `nanaAPI.search()`
