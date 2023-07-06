Node Image Scraper
========================
Scrape images from the web easily.
Usage
------------------------
The image-scrape module provides a class which needs to be constructed with a url:
```JavaScript
var Scraper = require("image-scraper");

var scraper = new Scraper("https://apod.nasa.gov/apod/astropix.html");
```
The url can be changed easily:
```JavaScript
scraper.address = "http://www.npmjs.org";
```
The scraper object provides the .scrape() method.
The scrape method accepts one optional argument: a callback function.

This callback function can also be set using the .on() method.

```JavaScript
scraper.on("image", function(image){

	// Do something.	
});
```
As soon as 'scraper.scrape()' is called, the callback will be fired with every image found on the webpage, note however that dynamically generated images will not be found.

The image object that is passed to the callback has the following properties and methods:
```JavaScript
// The attributes found in the image tag, which is parsed by Cheerio (https://npmjs.org/package/cheerio).
image.attributes;
// The basename of the image.
image.name;
// Absolute path to the folder the image will be saved to.
image.saveTo;
// Extension of the image file.
image.extension;
// The absolute URL of the image.
image.address;
// The URL of the page the image is scraped from.
image.fromAddress;
// Save the image.
image.save();
```
The behaviour of image.save() can be changed by setting the name, saveTo, and extension properties.
The saveTo property is by default set to the current directory, and the other two properties are by default set to the data found in the src attribute of the img tag.

Thus, the smallest program that scans a webpage for images and saves them in the current directory looks as follows:
```JavaScript
var Scraper = require('image-scraper');
var scraper = new Scraper('https://apod.nasa.gov/apod/astropix.html');

scraper.scrape(function(image) { 
	image.save();
});
```
