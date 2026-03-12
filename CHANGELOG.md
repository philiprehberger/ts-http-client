# Changelog

## 0.3.0

- Add auth helper (bearer and basic authentication)
- Add exponential backoff strategy with jitter and maxBackoff cap
- Fix timeout cleanup leak when fetch completes before timeout
- Fix error body parsing for non-JSON responses
- Expand test suite (24 tests)

## 0.2.3

- Fix npm package name references in README

## 0.2.2

- Fix npm package name (restore original name without ts- prefix)

## 0.2.1

- Update repository URLs to new ts-prefixed GitHub repo

## 0.2.0

- Add test suite (5 tests covering client creation, HttpError, interceptors)
- Add CI workflow for push/PR testing
- Add test step to publish workflow
- Add API reference tables to README

## 0.1.0
- Initial release
