# Changelog

All notable changes to this project will be documented in this file. This project adheres to [SemVer](https://semver.org/spec/v2.0.0.html).

## [1.1.5] - 2021-12-29

### Changed
- Return Not Found from `string` to `null`

## [1.1.4] - 2021-05-06

### Added
- Fuction to modify the keyword on `lib/nHentai.js`

### Changed
- URL variables on `lib/nHentai.js` to using the new function
- v1.1.3 date on `CHANGELOG.md` file

## [1.1.3] - 2021-01-07

### Changed
- Axios version to `0.21.1`
- `test/testing.js` to `test/test.js`
- node package manager from `pnpm` to `npm`

### Removed
- old `test/test.js`
- `pnpm-lock.yaml`

## [1.1.2] - 2020-07-30

### Added
-	conddition to get `num_results` alternative
-	condition to check if no `pagination` on page and set default to `1`

### Changed
-	regex `keyword.replace` on some function
-	simplify the additional function to get popular sort
-	fix `null` on `num_results` and `num_pages`
-	fix `.related()` API if the query is `number`

## [1.1.1] - 2020-07-29

### Changed
- 	fix additional function to get sort for some main function

## [1.1.0] - 2020-07-29

### Added

-   new popular parameter on some function so now can use `"today"`, `"week"`, and `"all"` or `true`
-   mocha test file, `test/test.js`
-   new additional function on `nHentai.js` to get popular sort that will use by some main function

### Changed

-   query stringify for `search` function
-   parameter interface on some function at `index.d.ts` file

## [1.0.6] - 2020-06-25

### Added

-   This CHANGELOG file.

### Changed

-   Fixed `num_pages` result in Request API file.

[1.1.4]: https://github.com/masami45/nana-api/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/masami45/nana-api/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/masami45/nana-api/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/masami45/nana-api/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/masami45/nana-api/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/masami45/nana-api/releases/tag/v1.0.6

